import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { getProvider, ProviderError } from "@/lib/providers";
import { toProviderConnection } from "@/lib/sync";
import { aiConfigured } from "@/lib/insights";

// 広告クリエイティブのPDCA。
// 「どの見出し・説明文が効いていて、どれを差し替えるべきか」を評価ラベル＋実績＋AI提案で出す。
// 判定基準は運用ルール手順書 §2-C（低評価が2週間継続→差し替え候補）と §7-D（見出し15本・ピン留めは最小限）。

export const CREATIVE_DAYS = 30;

type DbConnection = Parameters<typeof toProviderConnection>[0] & { organizationId: string; mode: string };

const EXT_TYPES = ["SITELINK", "CALLOUT", "STRUCTURED_SNIPPET"];

// 媒体からアセットを取得し、接続単位で入れ替える。
// lowSince（低評価が続いた起点）と AI の提案は、同じアセットなら引き継ぐ。
export async function syncCreatives(
  conn: DbConnection,
  days = CREATIVE_DAYS
): Promise<{ assets: number; creatives: number; errors: string[] }> {
  const pc = toProviderConnection(conn);
  const provider = getProvider(pc.platform, conn.mode);
  if (!provider.listCreatives) throw new ProviderError("この媒体は広告アセット分析に対応していません");

  const report = await provider.listCreatives(pc, days);

  const existing = await prisma.adAsset.findMany({
    where: { connectionId: conn.id },
    select: { assetKey: true, lowSince: true, aiVerdict: true, aiSuggestion: true, aiReason: true, performanceLabel: true },
  });
  const prev = new Map(existing.map((e) => [e.assetKey, e]));
  const now = new Date();

  const data = report.assets.map((a) => {
    const assetKey = `${a.adExternalId ?? a.campaignExternalId}|${a.fieldType}|${a.text}`;
    const before = prev.get(assetKey);
    // LOW になった起点を保持する（LOW を抜けたらリセット）
    const lowSince =
      a.performanceLabel === "LOW" ? (before?.performanceLabel === "LOW" ? before.lowSince ?? now : now) : null;
    // テキストが同じなら過去のAI提案を引き継ぐ（評価が変わったら破棄して再分析させる）
    const keepAi = before && before.performanceLabel === a.performanceLabel;
    return {
      organizationId: conn.organizationId,
      connectionId: conn.id,
      assetKey,
      campaignExternalId: a.campaignExternalId,
      campaignName: a.campaignName,
      adGroupExternalId: a.adGroupExternalId,
      adGroupName: a.adGroupName,
      adExternalId: a.adExternalId,
      fieldType: a.fieldType,
      text: a.text,
      performanceLabel: a.performanceLabel,
      pinnedField: a.pinnedField,
      impressions: a.impressions,
      clicks: a.clicks,
      costYen: a.costYen,
      conversions: a.conversions,
      lowSince,
      aiVerdict: keepAi ? before!.aiVerdict : null,
      aiSuggestion: keepAi ? before!.aiSuggestion : null,
      aiReason: keepAi ? before!.aiReason : null,
      syncedAt: now,
    };
  });

  await prisma.$transaction([
    prisma.adAsset.deleteMany({ where: { connectionId: conn.id } }),
    prisma.adAsset.createMany({ data }),
    prisma.adCreative.deleteMany({ where: { connectionId: conn.id } }),
    prisma.adCreative.createMany({
      data: report.creatives.map((c) => ({
        organizationId: conn.organizationId,
        connectionId: conn.id,
        adExternalId: c.adExternalId,
        campaignExternalId: c.campaignExternalId,
        campaignName: c.campaignName,
        adGroupExternalId: c.adGroupExternalId,
        adGroupName: c.adGroupName,
        adStrength: c.adStrength,
        headlineCount: c.headlineCount,
        descriptionCount: c.descriptionCount,
        pinnedCount: c.pinnedCount,
        finalUrl: c.finalUrl,
        extensions: (report.extensionsByCampaign[c.campaignExternalId] ?? []).filter((t) => EXT_TYPES.includes(t)).join(","),
        syncedAt: now,
      })),
    }),
  ]);

  return { assets: data.length, creatives: report.creatives.length, errors: report.errors };
}

// ── AIによる改善提案 ────────────────────────────────

const SYSTEM = `あなたは日本のリスティング広告のコピーライター兼運用者です。
レスポンシブ検索広告（RSA）の見出し・説明文について、実績と評価ラベルを見て改善判断を出してください。

判定（verdict）:
- "replace" … 差し替えるべき。評価が「LOW」で改善の見込みが薄い、訴求が弱い、他の見出しと重複している。
- "keep" … 維持。成果が出ている、または判断にはデータ不足。
- "add" … この訴求軸が不足している（既存アセットには無い切り口）。text は空でよい。

ルール:
- suggestion には、差し替え・追加する具体的な日本語の文言を書く。見出しは全角15文字以内（半角30文字以内）、説明文は全角45文字以内（半角90文字以内）を厳守。
- 既存の勝ちアセット（BEST/GOOD）と訴求が重複する案は出さない。
- 数字・実績・限定条件・ベネフィットなど、既存に無い切り口を優先する。
- 誇大表現、最上級表現（No.1、日本一など）は根拠がないため使わない。
- reason は日本語で30文字以内。
- 出力は JSON 配列のみ。マークダウンや説明文を付けない。
形式: [{"assetKey":"...","verdict":"replace|keep|add","suggestion":"...","reason":"..."}]
"add" の場合は assetKey に対象の広告グループ名を入れる。`;

export async function analyzeCreatives(connectionId: string): Promise<{ analyzed: number }> {
  if (!aiConfigured()) throw new Error("ANTHROPIC_API_KEY が未設定です");

  // 未分析、かつ判断材料になる（表示があるか低評価）アセットに絞る
  const assets = await prisma.adAsset.findMany({
    where: {
      connectionId,
      aiVerdict: null,
      fieldType: { in: ["HEADLINE", "DESCRIPTION"] },
    },
    orderBy: { impressions: "desc" },
    take: 120,
  });
  if (assets.length === 0) return { analyzed: 0 };

  const creatives = await prisma.adCreative.findMany({ where: { connectionId }, take: 50 });
  const ctx = creatives
    .map((c) => `広告グループ「${c.adGroupName}」: 広告の有効性=${c.adStrength ?? "不明"} 見出し${c.headlineCount}本 説明文${c.descriptionCount}本 ピン留め${c.pinnedCount}件 LP=${c.finalUrl ?? "不明"}`)
    .join("\n");

  const input =
    `【広告グループの構成】\n${ctx}\n\n【アセット一覧】\n` +
    assets
      .map((a) => {
        const ctr = a.impressions > 0 ? ((a.clicks / a.impressions) * 100).toFixed(2) : "0";
        return `assetKey=${a.assetKey}\n  種別=${a.fieldType === "HEADLINE" ? "見出し" : "説明文"} 評価=${a.performanceLabel ?? "未評価"}${a.pinnedField ? " ピン留めあり" : ""}\n  文言="${a.text}"\n  表示${a.impressions} クリック${a.clicks} CTR${ctr}% CV${a.conversions.toFixed(1)}`;
      })
      .join("\n");

  const client = new Anthropic();
  const stream = client.messages.stream({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    messages: [{ role: "user", content: input }],
  });
  const message = await stream.finalMessage();
  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("AI分析の結果を解析できませんでした");
  const parsed = JSON.parse(text.slice(start, end + 1)) as Array<{
    assetKey?: string;
    verdict?: string;
    suggestion?: string;
    reason?: string;
  }>;

  let analyzed = 0;
  for (const p of parsed) {
    if (!p.assetKey) continue;
    const verdict = ["replace", "keep", "add"].includes(p.verdict ?? "") ? p.verdict! : "keep";
    const r = await prisma.adAsset.updateMany({
      where: { connectionId, assetKey: p.assetKey },
      data: {
        aiVerdict: verdict,
        aiSuggestion: (p.suggestion ?? "").slice(0, 200) || null,
        aiReason: (p.reason ?? "").slice(0, 100) || null,
      },
    });
    analyzed += r.count;
  }
  // "add"（不足する訴求軸の提案）は既存アセットに紐づかないため、まとめて1件のインサイトに残す
  const adds = parsed.filter((p) => p.verdict === "add" && p.suggestion);
  if (adds.length > 0) {
    const conn = await prisma.adAsset.findFirst({ where: { connectionId }, select: { organizationId: true } });
    if (conn) {
      await prisma.insight.create({
        data: {
          organizationId: conn.organizationId,
          kind: "recommendation",
          title: `追加すべき訴求の提案（${adds.length}件）`,
          body:
            "既存のアセットに無い切り口として、以下の追加を提案します。既存の勝ちアセットは残したまま、新規として追加してください（全入れ替えはしない・手順書§2-C）。\n\n" +
            adds.map((a) => `- 「${a.suggestion}」${a.reason ? ` — ${a.reason}` : ""}（対象: ${a.assetKey}）`).join("\n"),
          source: "manual",
        },
      });
    }
  }
  return { analyzed };
}

// ── 診断（ルールベース） ────────────────────────────

export interface CreativeFinding {
  level: "crit" | "warn" | "good" | "info";
  title: string;
  evidence: string;
  action: string;
}

const LOW_DAYS = 14; // 手順書§2-C: 低評価が2週間継続したら差し替え候補

export function diagnoseCreatives(
  assets: {
    fieldType: string;
    text: string;
    performanceLabel: string | null;
    lowSince: Date | null;
    impressions: number;
    clicks: number;
    campaignName: string;
    adGroupName: string | null;
  }[],
  creatives: {
    adGroupName: string;
    campaignName: string;
    adStrength: string | null;
    headlineCount: number;
    descriptionCount: number;
    pinnedCount: number;
    extensions: string | null;
  }[]
): CreativeFinding[] {
  const out: CreativeFinding[] = [];

  // 低評価が2週間以上続いているアセット
  const stale = assets.filter(
    (a) => a.performanceLabel === "LOW" && a.lowSince && Date.now() - a.lowSince.getTime() >= LOW_DAYS * 86400_000
  );
  if (stale.length > 0) {
    out.push({
      level: "warn",
      title: `低評価が2週間以上続くアセットが ${stale.length}件`,
      evidence: stale.slice(0, 5).map((a) => `「${a.text}」（${a.fieldType === "HEADLINE" ? "見出し" : "説明文"} / ${a.adGroupName ?? a.campaignName}）`).join("、"),
      action: "差し替え候補です。既存の勝ちアセット（最良・良）は残したまま、新しい訴求を追加して比較してください（全入れ替えはしない・手順書§2-C）。",
    });
  }

  // 広告の有効性が低い
  const weak = creatives.filter((c) => c.adStrength === "POOR" || c.adStrength === "AVERAGE");
  for (const c of weak.slice(0, 5)) {
    out.push({
      level: c.adStrength === "POOR" ? "crit" : "warn",
      title: `広告の有効性が${c.adStrength === "POOR" ? "「低い」" : "「平均的」"}: ${c.adGroupName}`,
      evidence: `見出し ${c.headlineCount}本 / 説明文 ${c.descriptionCount}本${c.pinnedCount > 0 ? ` / ピン留め ${c.pinnedCount}件` : ""}（${c.campaignName}）。`,
      action: `見出しは15本、説明文は4本の上限近くまで入稿し、訴求を多様化してください（手順書§7-D）。${c.pinnedCount > 2 ? "ピン留めが多いと組み合わせ最適化が働きません。法務・ブランド上必須のものだけに絞ってください。" : ""}`,
    });
  }

  // 入稿本数が不足（有効性が良好でも機会損失）
  const thin = creatives.filter((c) => c.headlineCount > 0 && c.headlineCount < 8 && c.adStrength !== "POOR" && c.adStrength !== "AVERAGE");
  if (thin.length > 0) {
    out.push({
      level: "info",
      title: `見出しの本数が少ない広告が ${thin.length}件`,
      evidence: thin.slice(0, 4).map((c) => `${c.adGroupName}（見出し${c.headlineCount}本）`).join("、"),
      action: "見出しは上限15本近くまで入れると組み合わせの探索範囲が広がります。関連性の低いものは入れず、訴求軸を変えた案を足してください。",
    });
  }

  // 拡張アセットの未設定
  const missing = creatives.filter((c) => {
    const set = (c.extensions ?? "").split(",").filter(Boolean);
    return EXT_TYPES.some((t) => !set.includes(t));
  });
  if (missing.length > 0) {
    const c = missing[0];
    const set = (c.extensions ?? "").split(",").filter(Boolean);
    const lack = EXT_TYPES.filter((t) => !set.includes(t)).map(
      (t) => ({ SITELINK: "サイトリンク", CALLOUT: "コールアウト", STRUCTURED_SNIPPET: "構造化スニペット" })[t]
    );
    out.push({
      level: "warn",
      title: `拡張アセットが未設定: ${lack.join("・")}`,
      evidence: `${missing.length}件の広告が属するキャンペーンで未設定です（${c.campaignName} ほか）。`,
      action: "拡張アセットは広告の占有面積を増やしCTRを押し上げます。サイトリンク・コールアウト・構造化スニペットは可能な限り設定してください（手順書§7-D）。",
    });
  }

  // 成果の出ているアセット（勝ちパターンの共有）
  const best = assets.filter((a) => a.performanceLabel === "BEST");
  if (best.length > 0) {
    out.push({
      level: "good",
      title: `評価「最良」のアセットが ${best.length}件`,
      evidence: best.slice(0, 5).map((a) => `「${a.text}」`).join("、"),
      action: "この訴求が効いています。他の広告グループにも横展開し、似た切り口の派生案を追加してください。差し替え時もこれらは残すこと。",
    });
  }

  return out;
}
