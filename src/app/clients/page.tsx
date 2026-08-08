import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getOrgContext } from "@/lib/auth-helpers";
import { computePacing, PACING_LABEL, type Pacing } from "@/lib/pacing";
import { PLATFORMS, isPlatformId } from "@/lib/platforms";
import { ClientsClient, type ClientRow } from "./ClientsClient";

export const dynamic = "force-dynamic";

// 代理店向けの進捗管理。全クライアント（接続）の消化ペース・着地予想・目標達成を横並びで見る。

export default async function ClientsPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  const orgId = ctx.organizationId;

  const jst = new Date(Date.now() + 9 * 3600_000);
  const monthStart = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1));
  const since30 = new Date(Date.now() - 30 * 86400_000);

  const [conns, mtdMetrics, recentMetrics, alerts, templates] = await Promise.all([
    prisma.adConnection.findMany({
      where: { organizationId: orgId, status: { not: "revoked" } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.dailyMetric.findMany({
      where: { organizationId: orgId, date: { gte: monthStart } },
      select: { date: true, costYen: true, campaign: { select: { connectionId: true } } },
    }),
    prisma.dailyMetric.findMany({
      where: { organizationId: orgId, date: { gte: since30 } },
      select: {
        costYen: true, conversions: true, conversionValueYen: true, clicks: true, impressions: true,
        campaign: { select: { connectionId: true } },
      },
    }),
    prisma.insight.findMany({
      where: { organizationId: orgId, kind: "alert", status: "new" },
      select: { id: true, title: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.reportTemplate.findMany({ where: { organizationId: orgId } }),
  ]);

  const rows: ClientRow[] = conns.map((c) => {
    const mtd = mtdMetrics
      .filter((m) => m.campaign.connectionId === c.id)
      .map((m) => ({ date: m.date, costYen: m.costYen }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    const pacing: Pacing = computePacing({ monthlyBudgetYen: c.monthlyBudgetYen, mtdDaily: mtd });

    const recent = recentMetrics.filter((m) => m.campaign.connectionId === c.id);
    const cost = recent.reduce((n, m) => n + m.costYen, 0);
    const cv = recent.reduce((n, m) => n + m.conversions, 0);
    const value = recent.reduce((n, m) => n + m.conversionValueYen, 0);
    const cpa = cv > 0 ? cost / cv : null;

    return {
      id: c.id,
      accountName: c.accountName,
      platform: c.platform,
      platformLabel: isPlatformId(c.platform) ? PLATFORMS[c.platform].short : c.platform,
      platformColor: isPlatformId(c.platform) ? PLATFORMS[c.platform].color : "#94a3b8",
      mode: c.mode,
      status: c.status,
      lastError: c.lastError,
      lastSyncedAt: c.lastSyncedAt?.toISOString().slice(0, 16).replace("T", " ") ?? null,
      pacing: {
        status: pacing.status,
        statusLabel: PACING_LABEL[pacing.status],
        monthlyBudgetYen: pacing.monthlyBudgetYen,
        mtdYen: pacing.mtdYen,
        forecastYen: pacing.forecastYen,
        forecastRate: pacing.forecastRate,
        recommendedDailyYen: pacing.recommendedDailyYen,
        recentAvgDaily: pacing.recentAvgDaily,
        daysRemaining: pacing.daysRemaining,
      },
      cost30: cost,
      cv30: cv,
      cpa30: cpa,
      roas30: cost > 0 ? (value / cost) * 100 : 0,
      targetCpaYen: c.targetCpaYen,
      targetRoas: c.targetRoas,
      hasTemplate: templates.some((t) => t.connectionId === c.id),
      autoSend: templates.find((t) => t.connectionId === c.id)?.autoSend ?? false,
    };
  });

  return (
    <ClientsClient
      rows={rows}
      alerts={alerts.map((a) => ({ id: a.id, title: a.title, at: a.createdAt.toISOString().slice(5, 10) }))}
    />
  );
}
