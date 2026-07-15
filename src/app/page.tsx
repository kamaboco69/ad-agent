import { prisma } from "@/lib/db";
import { requireOrgPage } from "@/lib/auth-helpers";
import { PLATFORM_IDS, PLATFORMS } from "@/lib/platforms";
import { apiConnectAvailable } from "@/lib/providers";
import { aiConfigured } from "@/lib/insights";
import {
  DashboardClient,
  type DashboardData,
  type Kpi,
  type PlatformRow,
  type CampaignRow,
} from "./DashboardClient";

export const dynamic = "force-dynamic";

function emptyKpi(): Kpi {
  return { costYen: 0, impressions: 0, clicks: 0, conversions: 0, conversionValueYen: 0 };
}

function addTo(k: Kpi, m: { costYen: number; impressions: number; clicks: number; conversions: number; conversionValueYen: number }) {
  k.costYen += m.costYen;
  k.impressions += m.impressions;
  k.clicks += m.clicks;
  k.conversions += m.conversions;
  k.conversionValueYen += m.conversionValueYen;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { organizationId } = await requireOrgPage();
  const sp = await searchParams;
  const days = sp.days === "7" ? 7 : sp.days === "90" ? 90 : 30;

  const start = new Date(Date.now() - days * 86400_000);

  const [connections, metrics, insights] = await Promise.all([
    prisma.adConnection.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        platform: true,
        mode: true,
        status: true,
        accountName: true,
        monthlyBudgetYen: true,
        autoExclude: true,
        lastSyncedAt: true,
        lastError: true,
      },
    }),
    prisma.dailyMetric.findMany({
      where: { organizationId, date: { gte: start } },
      select: {
        date: true,
        impressions: true,
        clicks: true,
        costYen: true,
        conversions: true,
        conversionValueYen: true,
        campaign: {
          select: {
            id: true,
            name: true,
            status: true,
            objective: true,
            dailyBudgetYen: true,
            connection: { select: { platform: true, mode: true } },
          },
        },
      },
      orderBy: { date: "asc" },
    }),
    prisma.insight.findMany({
      where: { organizationId, status: { not: "dismissed" } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, kind: true, title: true, body: true, status: true, createdAt: true },
    }),
  ]);

  // 集計（org単位のデータ量は小さいのでJSで集計）
  const totals = emptyKpi();
  const dailyMap = new Map<string, { date: string; byPlatform: Record<string, number>; total: number }>();
  const platformMap = new Map<string, Kpi>();
  const campaignMap = new Map<string, CampaignRow>();

  for (const m of metrics) {
    const platform = m.campaign.connection.platform;
    const dateKey = m.date.toISOString().slice(0, 10);

    addTo(totals, m);

    const d = dailyMap.get(dateKey) ?? { date: dateKey, byPlatform: {}, total: 0 };
    d.byPlatform[platform] = (d.byPlatform[platform] ?? 0) + m.costYen;
    d.total += m.costYen;
    dailyMap.set(dateKey, d);

    const p = platformMap.get(platform) ?? emptyKpi();
    addTo(p, m);
    platformMap.set(platform, p);

    const c =
      campaignMap.get(m.campaign.id) ??
      ({
        id: m.campaign.id,
        name: m.campaign.name,
        platform,
        mode: m.campaign.connection.mode,
        status: m.campaign.status,
        objective: m.campaign.objective,
        dailyBudgetYen: m.campaign.dailyBudgetYen,
        ...emptyKpi(),
      } as CampaignRow);
    addTo(c, m);
    campaignMap.set(m.campaign.id, c);
  }

  const platformAgg: PlatformRow[] = PLATFORM_IDS.filter((id) => platformMap.has(id)).map((id) => ({
    platform: id,
    ...platformMap.get(id)!,
  }));

  const data: DashboardData = {
    days,
    totals,
    daily: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    platformAgg,
    campaigns: [...campaignMap.values()].sort((a, b) => b.costYen - a.costYen),
    platforms: PLATFORM_IDS.map((id) => ({
      id,
      label: PLATFORMS[id].label,
      short: PLATFORMS[id].short,
      color: PLATFORMS[id].color,
      apiName: PLATFORMS[id].apiName,
      note: PLATFORMS[id].note ?? null,
      apiAvailable: apiConnectAvailable(id),
      connections: connections
        .filter((c) => c.platform === id)
        .map((c) => ({
          id: c.id,
          mode: c.mode,
          status: c.status,
          accountName: c.accountName,
          monthlyBudgetYen: c.monthlyBudgetYen,
          autoExclude: c.autoExclude,
          lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
          lastError: c.lastError,
        })),
    })),
    insights: insights.map((i) => ({
      id: i.id,
      kind: i.kind,
      title: i.title,
      body: i.body,
      status: i.status,
      createdAt: i.createdAt.toISOString(),
    })),
    aiConfigured: aiConfigured(),
  };

  return <DashboardClient data={data} />;
}
