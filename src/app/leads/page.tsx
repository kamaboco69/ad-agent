import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getOrgContext } from "@/lib/auth-helpers";
import { computeLeadKpi, buildCohorts } from "@/lib/leads";
import { LeadsClient, type LeadRow } from "./LeadsClient";

export const dynamic = "force-dynamic";

// BtoBリード管理。広告費とリード個票を突き合わせて CPO / CAC を出す。
// 期間は「リード獲得日」基準。BtoBは検討期間が長いので月次コホートで追う。

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  const sp = await searchParams;
  const days = sp.days === "30" || sp.days === "180" || sp.days === "365" ? Number(sp.days) : 90;
  const since = new Date(Date.now() - days * 86400_000);

  const [leads, metrics, connections, ruleRow] = await Promise.all([
    prisma.lead.findMany({
      where: { organizationId: ctx.organizationId, leadAt: { gte: since } },
      orderBy: { leadAt: "desc" },
      select: {
        id: true, email: true, companyName: true, personName: true, memo: true,
        validity: true, invalidReason: true, stage: true, lost: true, overridden: true,
        dealAmountYen: true, leadAt: true, campaignNameRaw: true, gclid: true,
        campaign: { select: { name: true } },
      },
    }),
    prisma.dailyMetric.findMany({
      where: { organizationId: ctx.organizationId, date: { gte: since } },
      select: { date: true, costYen: true },
    }),
    prisma.adConnection.findMany({
      where: { organizationId: ctx.organizationId },
      select: { accountName: true, targetCpoYen: true, targetCacYen: true, avgLtvYen: true },
    }),
    prisma.leadRuleSet.findUnique({ where: { organizationId: ctx.organizationId } }),
  ]);

  const costYen = metrics.reduce((a, m) => a + m.costYen, 0);
  // 目標値は接続ごとに持つが、リードは接続をまたぐため最初に設定されている値を代表として使う
  const target = {
    cpo: connections.find((c) => c.targetCpoYen)?.targetCpoYen ?? null,
    cac: connections.find((c) => c.targetCacYen)?.targetCacYen ?? null,
    ltv: connections.find((c) => c.avgLtvYen)?.avgLtvYen ?? null,
  };
  const kpi = computeLeadKpi(leads, costYen, target.ltv);

  const costByMonth = new Map<string, number>();
  for (const m of metrics) {
    const k = `${m.date.getUTCFullYear()}-${String(m.date.getUTCMonth() + 1).padStart(2, "0")}`;
    costByMonth.set(k, (costByMonth.get(k) ?? 0) + m.costYen);
  }
  const cohorts = buildCohorts(leads, costByMonth);

  const rows: LeadRow[] = leads.map((l) => ({
    id: l.id,
    email: l.email,
    companyName: l.companyName,
    personName: l.personName,
    memo: l.memo,
    validity: l.validity,
    invalidReason: l.invalidReason,
    stage: l.stage,
    lost: l.lost,
    overridden: l.overridden,
    dealAmountYen: l.dealAmountYen,
    leadAt: l.leadAt.toISOString().slice(0, 10),
    campaignName: l.campaign?.name ?? l.campaignNameRaw,
    hasGclid: !!l.gclid,
  }));

  return (
    <LeadsClient
      days={days}
      kpi={kpi}
      target={target}
      cohorts={cohorts}
      leads={rows}
      rules={{
        freeEmailInvalid: ruleRow?.freeEmailInvalid ?? true,
        requireCompany: ruleRow?.requireCompany ?? false,
        blockedDomains: ruleRow?.blockedDomains ?? null,
        blockedKeywords: ruleRow?.blockedKeywords ?? "求人\n採用\n営業\n取材\n提携\nセールス",
      }}
    />
  );
}
