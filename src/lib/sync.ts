import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { isPlatformId } from "@/lib/platforms";
import { getProvider, type ProviderConnection } from "@/lib/providers";

// 接続1件をプロバイダから同期（キャンペーン・日次実績を upsert）。
// cron と手動同期の両方から呼ばれる。

export const DEFAULT_SYNC_DAYS = 90;

export interface SyncOutcome {
  connectionId: string;
  platform: string;
  ok: boolean;
  campaigns: number;
  metrics: number;
  error?: string;
}

type DbConnection = {
  id: string;
  organizationId: string;
  platform: string;
  mode: string;
  externalAccountId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
};

export function toProviderConnection(conn: DbConnection): ProviderConnection {
  if (!isPlatformId(conn.platform)) throw new Error(`未対応の媒体です: ${conn.platform}`);
  return {
    id: conn.id,
    platform: conn.platform,
    externalAccountId: conn.externalAccountId,
    accessToken: conn.accessToken ? decryptSecret(conn.accessToken) : null,
    refreshToken: conn.refreshToken ? decryptSecret(conn.refreshToken) : null,
  };
}

export async function syncConnection(conn: DbConnection, days = DEFAULT_SYNC_DAYS): Promise<SyncOutcome> {
  const base: SyncOutcome = { connectionId: conn.id, platform: conn.platform, ok: false, campaigns: 0, metrics: 0 };
  try {
    const provider = getProvider(toProviderConnection(conn).platform, conn.mode);
    const result = await provider.sync(toProviderConnection(conn), days);

    // キャンペーンを upsert し、externalId → campaign.id の対応表を作る
    const idMap = new Map<string, string>();
    for (const c of result.campaigns) {
      const saved = await prisma.campaign.upsert({
        where: { connectionId_externalId: { connectionId: conn.id, externalId: c.externalId } },
        update: {
          name: c.name,
          status: c.status,
          objective: c.objective,
          dailyBudgetYen: c.dailyBudgetYen,
          startDate: c.startDate,
          endDate: c.endDate,
        },
        create: {
          organizationId: conn.organizationId,
          connectionId: conn.id,
          externalId: c.externalId,
          name: c.name,
          status: c.status,
          objective: c.objective,
          dailyBudgetYen: c.dailyBudgetYen,
          startDate: c.startDate,
          endDate: c.endDate,
        },
        select: { id: true },
      });
      idMap.set(c.externalId, saved.id);
    }

    // 日次実績を upsert（createMany + onConflict 相当を1件ずつ。同期は数百行規模なので許容）
    let metricCount = 0;
    for (const m of result.metrics) {
      const campaignId = idMap.get(m.campaignExternalId);
      if (!campaignId) continue;
      const date = new Date(`${m.date}T00:00:00Z`);
      await prisma.dailyMetric.upsert({
        where: { campaignId_date: { campaignId, date } },
        update: {
          impressions: m.impressions,
          clicks: m.clicks,
          costYen: m.costYen,
          conversions: m.conversions,
          conversionValueYen: m.conversionValueYen,
        },
        create: {
          organizationId: conn.organizationId,
          campaignId,
          date,
          impressions: m.impressions,
          clicks: m.clicks,
          costYen: m.costYen,
          conversions: m.conversions,
          conversionValueYen: m.conversionValueYen,
        },
      });
      metricCount++;
    }

    await prisma.adConnection.update({
      where: { id: conn.id },
      data: { lastSyncedAt: new Date(), lastError: null, status: "connected" },
    });

    return { ...base, ok: true, campaigns: result.campaigns.length, metrics: metricCount };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.adConnection
      .update({ where: { id: conn.id }, data: { lastError: message, status: "error" } })
      .catch(() => {});
    return { ...base, error: message };
  }
}

// 組織内の全接続を同期
export async function syncOrganization(organizationId: string, days = DEFAULT_SYNC_DAYS): Promise<SyncOutcome[]> {
  const conns = await prisma.adConnection.findMany({
    where: { organizationId, status: { not: "revoked" } },
  });
  const outcomes: SyncOutcome[] = [];
  for (const conn of conns) {
    outcomes.push(await syncConnection(conn, days));
  }
  return outcomes;
}
