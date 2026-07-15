import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { PLATFORMS, isPlatformId } from "@/lib/platforms";

// AI インサイト: 直近実績を集計して Claude に渡し、日本語 Markdown の
// 分析レポート/改善提案を生成して Insight として保存する。

export function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

interface PlatformAgg {
  platform: string;
  label: string;
  costYen: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValueYen: number;
}

interface CampaignAgg extends Omit<PlatformAgg, "platform" | "label"> {
  name: string;
  platform: string;
  status: string;
  dailyBudgetYen: number | null;
}

type PeriodAgg = Omit<PlatformAgg, "platform" | "label">;

export interface MetricsSummary {
  periodStart: Date;
  periodEnd: Date;
  days: number;
  total: PeriodAgg;
  byPlatform: PlatformAgg[];
  byCampaign: CampaignAgg[];
  // 前期（直近期間の直前・同じ長さ）の比較用集計。前期に実績がなければ null
  prevTotal: PeriodAgg | null;
  prevByPlatform: Map<string, PeriodAgg>;
}

// 直近 days 日の実績を媒体別・キャンペーン別に集計（前期比較用に直前の同じ長さの期間も集計）
export async function buildMetricsSummary(organizationId: string, days = 30): Promise<MetricsSummary | null> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400_000);
  const prevStart = new Date(end.getTime() - 2 * days * 86400_000);

  const metrics = await prisma.dailyMetric.findMany({
    where: { organizationId, date: { gte: start } },
    select: {
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
          dailyBudgetYen: true,
          connection: { select: { platform: true } },
        },
      },
    },
  });
  if (metrics.length === 0) return null;

  // 前期分（トレンド比較用。媒体別まで）
  const prevMetrics = await prisma.dailyMetric.findMany({
    where: { organizationId, date: { gte: prevStart, lt: start } },
    select: {
      impressions: true,
      clicks: true,
      costYen: true,
      conversions: true,
      conversionValueYen: true,
      campaign: { select: { connection: { select: { platform: true } } } },
    },
  });
  const prevTotal: PeriodAgg = { costYen: 0, impressions: 0, clicks: 0, conversions: 0, conversionValueYen: 0 };
  const prevByPlatform = new Map<string, PeriodAgg>();
  for (const m of prevMetrics) {
    const platform = m.campaign.connection.platform;
    prevTotal.costYen += m.costYen;
    prevTotal.impressions += m.impressions;
    prevTotal.clicks += m.clicks;
    prevTotal.conversions += m.conversions;
    prevTotal.conversionValueYen += m.conversionValueYen;
    const p = prevByPlatform.get(platform) ?? { costYen: 0, impressions: 0, clicks: 0, conversions: 0, conversionValueYen: 0 };
    p.costYen += m.costYen;
    p.impressions += m.impressions;
    p.clicks += m.clicks;
    p.conversions += m.conversions;
    p.conversionValueYen += m.conversionValueYen;
    prevByPlatform.set(platform, p);
  }

  const total = { costYen: 0, impressions: 0, clicks: 0, conversions: 0, conversionValueYen: 0 };
  const platformMap = new Map<string, PlatformAgg>();
  const campaignMap = new Map<string, CampaignAgg>();

  for (const m of metrics) {
    const platform = m.campaign.connection.platform;
    total.costYen += m.costYen;
    total.impressions += m.impressions;
    total.clicks += m.clicks;
    total.conversions += m.conversions;
    total.conversionValueYen += m.conversionValueYen;

    const p = platformMap.get(platform) ?? {
      platform,
      label: isPlatformId(platform) ? PLATFORMS[platform].label : platform,
      costYen: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      conversionValueYen: 0,
    };
    p.costYen += m.costYen;
    p.impressions += m.impressions;
    p.clicks += m.clicks;
    p.conversions += m.conversions;
    p.conversionValueYen += m.conversionValueYen;
    platformMap.set(platform, p);

    const c = campaignMap.get(m.campaign.id) ?? {
      name: m.campaign.name,
      platform,
      status: m.campaign.status,
      dailyBudgetYen: m.campaign.dailyBudgetYen,
      costYen: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      conversionValueYen: 0,
    };
    c.costYen += m.costYen;
    c.impressions += m.impressions;
    c.clicks += m.clicks;
    c.conversions += m.conversions;
    c.conversionValueYen += m.conversionValueYen;
    campaignMap.set(m.campaign.id, c);
  }

  return {
    periodStart: start,
    periodEnd: end,
    days,
    total,
    byPlatform: [...platformMap.values()].sort((a, b) => b.costYen - a.costYen),
    byCampaign: [...campaignMap.values()].sort((a, b) => b.costYen - a.costYen),
    prevTotal: prevMetrics.length > 0 ? prevTotal : null,
    prevByPlatform,
  };
}

// 前期比の増減表記（前期実績がない・0のときは "—"）
function pct(cur: number, prev: number | undefined): string {
  if (!prev) return "—";
  const diff = ((cur - prev) / prev) * 100;
  return `${diff >= 0 ? "+" : ""}${diff.toFixed(0)}%`;
}

function trendRow(cur: PeriodAgg, prev: PeriodAgg | undefined): string {
  if (!prev) return "前期データなし";
  const curCpa = cur.conversions ? cur.costYen / cur.conversions : 0;
  const prevCpa = prev.conversions ? prev.costYen / prev.conversions : 0;
  return `消化額 ${pct(cur.costYen, prev.costYen)} / Click ${pct(cur.clicks, prev.clicks)} / CV ${pct(cur.conversions, prev.conversions)} / CPA ${curCpa && prevCpa ? pct(curCpa, prevCpa) : "—"}`;
}

function fmtRow(a: { costYen: number; impressions: number; clicks: number; conversions: number; conversionValueYen: number }) {
  const ctr = a.impressions ? ((a.clicks / a.impressions) * 100).toFixed(2) : "0";
  const cpc = a.clicks ? Math.round(a.costYen / a.clicks) : 0;
  const cpa = a.conversions ? Math.round(a.costYen / a.conversions) : null;
  const roas = a.costYen ? ((a.conversionValueYen / a.costYen) * 100).toFixed(0) : "0";
  return `消化額¥${a.costYen.toLocaleString()} / IMP ${a.impressions.toLocaleString()} / Click ${a.clicks.toLocaleString()} / CTR ${ctr}% / CPC ¥${cpc} / CV ${a.conversions.toFixed(1)} / CPA ${cpa ? `¥${cpa.toLocaleString()}` : "—"} / ROAS ${roas}%`;
}

// Claude に渡すテキストサマリー（トークン節約のため表形式のプレーンテキスト）
export function summaryToText(s: MetricsSummary): string {
  const lines: string[] = [];
  lines.push(`期間: 直近${s.days}日（〜${s.periodEnd.toISOString().slice(0, 10)}）`);
  lines.push(`全体: ${fmtRow(s.total)}`);
  if (s.prevTotal) lines.push(`全体の前期比（その前の${s.days}日と比較）: ${trendRow(s.total, s.prevTotal)}`);
  lines.push("");
  lines.push("【媒体別】");
  for (const p of s.byPlatform) {
    lines.push(`- ${p.label}: ${fmtRow(p)}`);
    const prev = s.prevByPlatform.get(p.platform);
    if (prev) lines.push(`  前期比: ${trendRow(p, prev)}`);
  }
  lines.push("");
  lines.push("【キャンペーン別（消化額上位20）】");
  for (const c of s.byCampaign.slice(0, 20)) {
    const label = isPlatformId(c.platform) ? PLATFORMS[c.platform].short : c.platform;
    lines.push(
      `- [${label}] ${c.name}（${c.status === "active" ? "配信中" : "停止中"}, 日予算${c.dailyBudgetYen ? `¥${c.dailyBudgetYen.toLocaleString()}` : "未設定"}）: ${fmtRow(c)}`
    );
  }
  return lines.join("\n");
}

const SYSTEM_PROMPT = `あなたは日本の広告運用コンサルタントです。Google広告・Yahoo!広告・Meta(Facebook/Instagram)・X・TikTokの運用に精通しています。
渡された実績データを分析し、広告主向けの分析レポートを日本語のMarkdownで書いてください。

構成:
## 全体サマリー （3〜4行。良い点と課題を端的に）
## 媒体別の評価 （媒体ごとに1〜2行。CPA/ROASを軸に）
## 改善アクション （優先度順に3〜5個。予算の増減・停止・クリエイティブ改善など、具体的な金額や対象キャンペーン名を挙げる）
## 注意点 （データの偏りや判断保留すべき点があれば。なければ省略可）

ルール:
- 数値は必ず渡されたデータに基づくこと。推測の数値を作らない。
- CV価値が0の認知系キャンペーンをCPA/ROASで断罪しない（目的が違う）。
- 前期比が渡されている場合は、悪化している媒体・指標（CPA上昇、CV減少など）を最優先で改善アクションに反映する。
- 冗長にしない。全体で600字〜1000字程度。`;

// 直近7日の変更ログを分析データに併記する（手順書§10: 実施アクションの併記）
async function recentActionsText(organizationId: string): Promise<string> {
  const actions = await prisma.changeLog.findMany({
    where: { organizationId, createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  if (actions.length === 0) return "";
  return (
    "\n\n【直近7日の実施アクション（変更ログ）】\n" +
    actions
      .map((a) => `- ${a.createdAt.toISOString().slice(5, 10)} ${a.detail}（${a.actor === "auto" ? "自動" : "手動"}）`)
      .join("\n")
  );
}

export interface GenerateInsightOptions {
  days?: number;
  source?: "manual" | "cron";
}

// 実績を分析して改善提案 Insight を生成・保存する
export async function generateInsight(organizationId: string, opts: GenerateInsightOptions = {}) {
  if (!aiConfigured()) throw new Error("ANTHROPIC_API_KEY が未設定です");
  const days = opts.days ?? 30;

  const summary = await buildMetricsSummary(organizationId, days);
  if (!summary) throw new Error("分析対象の実績データがありません。先に媒体を接続・同期してください。");

  const client = new Anthropic();
  const stream = client.messages.stream({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: summaryToText(summary) + (await recentActionsText(organizationId)) }],
  });
  const message = await stream.finalMessage();

  const body = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!body) throw new Error("分析結果の生成に失敗しました");

  const title =
    opts.source === "cron" ? `週次運用改善レポート（直近${days}日）` : `運用改善レポート（直近${days}日）`;
  return prisma.insight.create({
    data: {
      organizationId,
      kind: "recommendation",
      title,
      body,
      status: "new",
      periodStart: summary.periodStart,
      periodEnd: summary.periodEnd,
      source: opts.source ?? "manual",
    },
  });
}

// 週次の自動改善レポート生成（cron から呼ばれる）。
// 毎週月曜（JST）に、実績データのある全組織へ改善提案を生成する。
// 同一組織に直近3日以内の cron 製レポートがあればスキップ（同日2回のcron実行や再試行での重複防止）。
// force=true でゲートを無視して即生成（動作確認用。CRON_SECRET 保護下でのみ到達）。
export async function runWeeklyInsights(force = false): Promise<{ generated: number; skipped: number }> {
  if (!aiConfigured()) return { generated: 0, skipped: 0 };

  const nowJst = new Date(Date.now() + 9 * 3600_000);
  if (!force && nowJst.getUTCDay() !== 1) return { generated: 0, skipped: 0 }; // 月曜のみ

  const orgs = await prisma.adConnection.findMany({
    where: { status: { not: "revoked" } },
    select: { organizationId: true },
    distinct: ["organizationId"],
  });

  let generated = 0;
  let skipped = 0;
  for (const { organizationId } of orgs) {
    if (!force) {
      const recent = await prisma.insight.findFirst({
        where: {
          organizationId,
          kind: "recommendation",
          source: "cron",
          createdAt: { gte: new Date(Date.now() - 3 * 86400_000) },
        },
        select: { id: true },
      });
      if (recent) {
        skipped++;
        continue;
      }
    }
    try {
      await generateInsight(organizationId, { days: 30, source: "cron" });
      generated++;
    } catch {
      // 実績データなし等はスキップ（接続直後の組織など）
      skipped++;
    }
  }
  return { generated, skipped };
}

// 月予算に対する消化ペースを監視し、超過見込みなら alert Insight を作る（AI不使用）。
// cron から日次で呼ばれる。同月内の重複アラートは作らない。
export async function checkBudgetAlerts(organizationId: string): Promise<number> {
  const now = new Date(Date.now() + 9 * 3600_000); // JST
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const monthStart = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const dayOfMonth = now.getUTCDate();

  const connections = await prisma.adConnection.findMany({
    where: { organizationId, monthlyBudgetYen: { not: null }, status: { not: "revoked" } },
    select: { id: true, platform: true, accountName: true, monthlyBudgetYen: true, campaigns: { select: { id: true } } },
  });

  let created = 0;
  for (const conn of connections) {
    const budget = conn.monthlyBudgetYen!;
    if (budget <= 0 || conn.campaigns.length === 0) continue;

    const agg = await prisma.dailyMetric.aggregate({
      where: { campaignId: { in: conn.campaigns.map((c) => c.id) }, date: { gte: monthStart } },
      _sum: { costYen: true },
    });
    const spent = agg._sum.costYen ?? 0;
    const projected = Math.round((spent / Math.max(dayOfMonth, 1)) * daysInMonth);
    if (projected <= budget * 1.05) continue; // 5%までの超過見込みは許容

    const label = isPlatformId(conn.platform) ? PLATFORMS[conn.platform].label : conn.platform;
    const title = `予算超過見込み: ${label}`;
    // 同月・同接続のアラートが既にあればスキップ
    const existing = await prisma.insight.findFirst({
      where: { organizationId, kind: "alert", title, createdAt: { gte: monthStart } },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.insight.create({
      data: {
        organizationId,
        kind: "alert",
        title,
        body: [
          `**${label}（${conn.accountName}）** の消化ペースが月予算を超過する見込みです。`,
          "",
          `- 月予算: ¥${budget.toLocaleString()}`,
          `- 今月の消化額（${dayOfMonth}日時点）: ¥${spent.toLocaleString()}`,
          `- 月末着地見込み: **¥${projected.toLocaleString()}**（予算比 ${Math.round((projected / budget) * 100)}%）`,
          "",
          "日予算の引き下げ、または低効率キャンペーンの停止を検討してください。",
        ].join("\n"),
        status: "new",
        source: "cron",
      },
    });
    created++;
  }
  return created;
}
