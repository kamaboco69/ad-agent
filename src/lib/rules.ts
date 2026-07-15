import { prisma } from "@/lib/db";

// 運用ルールエンジン Phase 1（docs/rules-engine-design.html が正本）。
// 日次スナップショット・日次異常検知（L1）・変更ログの14日後自動検証。

const DAY = 86400_000;
const jstDay = (offset = 0) => {
  const d = new Date(Date.now() + 9 * 3600_000 - offset * DAY);
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00Z`);
};

export async function logChange(input: {
  organizationId: string;
  connectionId: string;
  campaignId?: string | null;
  kind: string;
  detail: string;
  actor?: "user" | "auto";
}) {
  await prisma.changeLog.create({
    data: { ...input, actor: input.actor ?? "user", verifyAt: new Date(Date.now() + 14 * DAY) },
  });
}

// 前日分の接続×日スナップショットを保存（毎日）
export async function snapshotDaily(): Promise<number> {
  const date = jstDay(1);
  const conns = await prisma.adConnection.findMany({
    where: { status: { not: "revoked" } },
    select: { id: true, organizationId: true },
  });
  let n = 0;
  for (const c of conns) {
    const agg = await prisma.dailyMetric.aggregate({
      where: { campaign: { connectionId: c.id }, date },
      _sum: { costYen: true, impressions: true, clicks: true, conversions: true, conversionValueYen: true },
    });
    const s = agg._sum;
    await prisma.dailySnapshot.upsert({
      where: { connectionId_date: { connectionId: c.id, date } },
      update: {
        costYen: s.costYen ?? 0,
        impressions: s.impressions ?? 0,
        clicks: s.clicks ?? 0,
        conversions: s.conversions ?? 0,
        conversionValueYen: s.conversionValueYen ?? 0,
      },
      create: {
        organizationId: c.organizationId,
        connectionId: c.id,
        date,
        costYen: s.costYen ?? 0,
        impressions: s.impressions ?? 0,
        clicks: s.clicks ?? 0,
        conversions: s.conversions ?? 0,
        conversionValueYen: s.conversionValueYen ?? 0,
      },
    });
    n++;
  }
  return n;
}

// 同タイトルのアラートを同日に重複作成しない
async function alertOnce(organizationId: string, title: string, body: string) {
  const dup = await prisma.insight.findFirst({
    where: { organizationId, title, createdAt: { gte: jstDay(0) } },
    select: { id: true },
  });
  if (dup) return false;
  await prisma.insight.create({ data: { organizationId, kind: "alert", title, body, source: "cron" } });
  return true;
}

// 日次異常検知（§1・§9）。9時の実行でのみ呼ぶ。
export async function runDailyChecks(): Promise<{ alerts: number }> {
  const conns = await prisma.adConnection.findMany({
    where: { status: { not: "revoked" }, mode: "api" },
  });
  let alerts = 0;
  for (const c of conns) {
    const snaps = await prisma.dailySnapshot.findMany({
      where: { connectionId: c.id, date: { gte: jstDay(14) } },
      orderBy: { date: "desc" },
    });
    const y = snaps.find((s) => s.date.getTime() === jstDay(1).getTime());
    const prev = snaps.find((s) => s.date.getTime() === jstDay(2).getTime());
    if (!y) continue;

    // CVゼロ24h（過去7日は平均0.5件以上あった場合のみ＝計測疑い。自動操作は一旦人の確認へ）
    const last7 = snaps.filter((s) => s.date.getTime() < jstDay(1).getTime()).slice(0, 7);
    const avgCv = last7.length ? last7.reduce((a, s) => a + s.conversions, 0) / last7.length : 0;
    if (y.conversions === 0 && avgCv >= 0.5) {
      if (await alertOnce(c.organizationId, `⚠ CVゼロ検知: ${c.accountName}`,
        `昨日のコンバージョンが0件でした（直近7日平均 ${avgCv.toFixed(1)}件）。成果悪化と決めつけず、まずタグ・計測の停止を疑ってください（手順書§5/§9）。計測確認まで自動最適化の適用は控えめに。`)) alerts++;
    }

    // 前日比±30%（消化額・CV）
    if (prev && prev.costYen > 1000) {
      const diff = ((y.costYen - prev.costYen) / prev.costYen) * 100;
      if (Math.abs(diff) >= 30) {
        if (await alertOnce(c.organizationId, `📊 消化額が前日比${diff >= 0 ? "+" : ""}${diff.toFixed(0)}%: ${c.accountName}`,
          `昨日の消化額 ¥${y.costYen.toLocaleString()}（前日 ¥${prev.costYen.toLocaleString()}）。キャンペーン単位で急増・急減の原因を確認してください（手順書§1）。`)) alerts++;
      }
    }

    // 月予算の消化ペース±10%（月予算設定時）
    if (c.monthlyBudgetYen) {
      const nowJst = new Date(Date.now() + 9 * 3600_000);
      const dayOfMonth = nowJst.getUTCDate();
      const daysInMonth = new Date(nowJst.getUTCFullYear(), nowJst.getUTCMonth() + 1, 0).getDate();
      const monthStart = new Date(`${nowJst.toISOString().slice(0, 8)}01T00:00:00Z`);
      const mtd = snaps.filter((s) => s.date >= monthStart).reduce((a, s) => a + s.costYen, 0);
      const expected = (c.monthlyBudgetYen / daysInMonth) * (dayOfMonth - 1);
      if (expected > 0) {
        const pace = ((mtd - expected) / expected) * 100;
        if (Math.abs(pace) > 10) {
          if (await alertOnce(c.organizationId, `💰 予算ペース${pace >= 0 ? "+" : ""}${pace.toFixed(0)}%: ${c.accountName}`,
            `月初からの消化 ¥${mtd.toLocaleString()} / 日割り目安 ¥${Math.round(expected).toLocaleString()}（月予算 ¥${c.monthlyBudgetYen.toLocaleString()}）。乖離の原因キャンペーンを特定してください（手順書§1）。`)) alerts++;
        }
      }
    }

    // CPAが目標の2倍超で3日以上継続（目標CPA設定時）
    if (c.targetCpaYen) {
      const d3 = [jstDay(1), jstDay(2), jstDay(3)].map((d) => snaps.find((s) => s.date.getTime() === d.getTime()));
      const bad = d3.every((s) => s && s.costYen > 0 && (s.conversions === 0 || s.costYen / s.conversions > c.targetCpaYen! * 2));
      if (bad) {
        if (await alertOnce(c.organizationId, `🚨 CPAが目標の2倍超×3日: ${c.accountName}`,
          `直近3日間、CPAが目標（¥${c.targetCpaYen.toLocaleString()}）の2倍を超えています。変更ログと外部要因を確認し、原因特定まで予算増額を凍結してください（手順書§9）。`)) alerts++;
      }
    }
  }
  return { alerts };
}

// 確認予定日が到来した変更ログの効果を自動検証（§0: 変更前14日 vs 変更後14日）
export async function verifyDueChanges(): Promise<{ verified: number }> {
  const due = await prisma.changeLog.findMany({
    where: { verifyAt: { lte: new Date() }, verifiedAt: null },
    take: 20,
  });
  let verified = 0;
  for (const log of due) {
    const mid = log.createdAt;
    const sum = async (from: Date, to: Date) =>
      prisma.dailySnapshot.aggregate({
        where: { connectionId: log.connectionId, date: { gte: from, lt: to } },
        _sum: { costYen: true, conversions: true },
      });
    const before = await sum(new Date(mid.getTime() - 14 * DAY), mid);
    const after = await sum(mid, new Date(mid.getTime() + 14 * DAY));
    const f = (s: { _sum: { costYen: number | null; conversions: number | null } }) => {
      const cost = s._sum.costYen ?? 0;
      const cv = s._sum.conversions ?? 0;
      return { cost, cv, cpa: cv > 0 ? Math.round(cost / cv) : null };
    };
    const b = f(before);
    const a = f(after);
    const verdict = `前14日: 消化¥${b.cost.toLocaleString()} / CV${b.cv.toFixed(1)} / CPA${b.cpa ? "¥" + b.cpa.toLocaleString() : "—"} → 後14日: 消化¥${a.cost.toLocaleString()} / CV${a.cv.toFixed(1)} / CPA${a.cpa ? "¥" + a.cpa.toLocaleString() : "—"}`;
    await prisma.changeLog.update({ where: { id: log.id }, data: { verifiedAt: new Date(), verdict } });
    const conn = await prisma.adConnection.findUnique({ where: { id: log.connectionId }, select: { accountName: true } });
    await prisma.insight.create({
      data: {
        organizationId: log.organizationId,
        kind: "report",
        title: `変更の効果検証: ${log.detail}`,
        body: `${conn?.accountName ?? ""} で ${log.createdAt.toISOString().slice(0, 10)} に実施した変更（${log.detail} / ${log.actor === "auto" ? "自動" : "手動"}）の前後比較です。\n\n${verdict}\n\n※ 判断はCV30件未満で断定しない原則（手順書§0）に従ってください。`,
        source: "cron",
      },
    });
    verified++;
  }
  return { verified };
}
