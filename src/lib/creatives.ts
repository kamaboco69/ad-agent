import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { getProvider, ProviderError } from "@/lib/providers";
import { toProviderConnection } from "@/lib/sync";
import { aiConfigured } from "@/lib/insights";

// 広告クリエイティブのPDCA。
// 「どの見出し・説明文が効いていて、どれを差し替えるべきか」を評価ラベル＋実績＋AI提案で出す。
// 判定基準は運用ルール手順書 §2-C（低評価が2週間継続→差し替え候補）と §7-D（見出し15本・ピン留めは最小限）。

export const CREATIVE_DAYS = 30;

// Google広告の文字数カウント: 全角（日本語など）は2文字分として数える。
// 見出し30・説明文90が上限＝日本語なら全角15文字・45文字。
export const AD_TEXT_LIMITS: Record<string, number> = { HEADLINE: 30, DESCRIPTION: 90 };

export function adTextLength(s: string): number {
  return [...s].reduce((n, ch) => n + (/[ -~｡-ﾟ]/.test(ch) ? 1 : 2), 0);
}

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
- **実績（表示回数）が0、評価が「評価対象外」の場合**（配信停止中・出稿直後など）は、実績ではなく
  コピーそのものの質で判断する。具体的には ①訴求の重複（似た意味の見出しが複数ある）
  ②訴求軸の偏り（価格・スピード・実績・保証・地域性・限定条件などのうち何が欠けているか）
  ③文字数の余り（上限に対して極端に短い＝情報量不足）④行動喚起の有無 を見る。
  データ不足を理由に判断を放棄しないこと。
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

// 1件だけ改善案を出す（一覧の「改善」ボタン用。全件分析を待たずに済む）
export async function suggestOneAsset(assetId: string): Promise<{ suggestion: string; reason: string }> {
  if (!aiConfigured()) throw new Error("ANTHROPIC_API_KEY が未設定です");

  const asset = await prisma.adAsset.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error("対象のアセットが見つかりません");

  // 同じ広告の他アセットを渡し、訴求が重複しない案を出させる
  const siblings = await prisma.adAsset.findMany({
    where: {
      connectionId: asset.connectionId,
      adExternalId: asset.adExternalId,
      fieldType: asset.fieldType,
      id: { not: assetId },
    },
    select: { text: true, performanceLabel: true, impressions: true, clicks: true },
  });

  const isHeadline = asset.fieldType === "HEADLINE";
  const limitJa = isHeadline ? 15 : 45;
  const perf =
    asset.impressions > 0
      ? `表示${asset.impressions}回・クリック${asset.clicks}回（CTR ${((asset.clicks / asset.impressions) * 100).toFixed(2)}%）・CV${asset.conversions.toFixed(1)}件`
      : "配信実績なし（コピーの質で判断してください）";

  const client = new Anthropic();
  const stream = client.messages.stream({
    model: "claude-opus-4-8",
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    system: `あなたは日本のリスティング広告のコピーライターです。指定された${isHeadline ? "見出し" : "説明文"}の改善案を1つだけ出してください。

制約:
- 全角${limitJa}文字以内を厳守（半角は0.5文字換算）。
- 同じ広告の他アセットと訴求が重複しないこと。既に使われている切り口は避ける。
- 数字・限定条件・ベネフィット・行動喚起のうち、既存に無い要素を入れる。
- 誇大表現や根拠のない最上級表現（No.1・日本一など）は使わない。
- 出力はJSONのみ: {"suggestion":"改善後の文言","reason":"変更理由(30文字以内)"}`,
    messages: [
      {
        role: "user",
        content: `【対象】${asset.fieldType === "HEADLINE" ? "見出し" : "説明文"}
現在の文言: 「${asset.text}」
実績: ${perf}
Google評価: ${asset.performanceLabel ?? "評価なし"}
広告グループ: ${asset.adGroupName ?? asset.campaignName}

【同じ広告の他の${isHeadline ? "見出し" : "説明文"}】
${siblings.map((s) => `- 「${s.text}」${s.impressions > 0 ? `（CTR ${((s.clicks / s.impressions) * 100).toFixed(2)}%）` : ""}`).join("\n") || "（なし）"}`,
      },
    ],
  });
  const message = await stream.finalMessage();
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("改善案を生成できませんでした");
  const parsed = JSON.parse(text.slice(s, e + 1)) as { suggestion?: string; reason?: string };
  if (!parsed.suggestion) throw new Error("改善案を生成できませんでした");

  const suggestion = parsed.suggestion.slice(0, 200);
  const reason = (parsed.reason ?? "").slice(0, 100);
  await prisma.adAsset.update({
    where: { id: assetId },
    data: { aiVerdict: "replace", aiSuggestion: suggestion, aiReason: reason },
  });
  return { suggestion, reason };
}

// ── アセットのスコアリング ──────────────────────────
// 実際の反応（同じ広告内での相対CTR・CV貢献）を主軸に採点する。
// RSAは複数アセットの組み合わせで配信されるため、絶対値ではなく
// 「同じ広告の中で平均より働いているか」で比較するのが妥当。

// 相対CTRがノイズにならない最低表示回数
const MIN_IMP_CONFIDENT = 300;
const MIN_IMP_PROVISIONAL = 50;

export type ScoreBasis = "performance" | "provisional" | "insufficient";

export interface AssetScore {
  score: number | null; // 0-100。実績が無ければ null
  grade: "A" | "B" | "C" | "D" | null;
  basis: ScoreBasis;
  ctrIndex: number | null; // 同じ広告内の平均CTRを100とした指数
  cvIndex: number | null;
  notes: string[];
}

interface ScorableAsset {
  text: string;
  performanceLabel: string | null;
  impressions: number;
  clicks: number;
  conversions: number;
}

export function scoreAsset(a: ScorableAsset, siblings: ScorableAsset[]): AssetScore {
  const notes: string[] = [];

  // 同じ広告・同じ種別のアセット全体を基準にする
  const totImp = siblings.reduce((n, s) => n + s.impressions, 0);
  const totClicks = siblings.reduce((n, s) => n + s.clicks, 0);
  const totCv = siblings.reduce((n, s) => n + s.conversions, 0);
  const avgCtr = totImp > 0 ? totClicks / totImp : 0;
  const avgCvr = totImp > 0 ? totCv / totImp : 0;

  if (a.impressions < MIN_IMP_PROVISIONAL || avgCtr === 0) {
    return {
      score: null,
      grade: null,
      basis: "insufficient",
      ctrIndex: null,
      cvIndex: null,
      notes: [
        a.impressions === 0
          ? "配信実績がないため採点できません（広告が停止中の可能性）"
          : `表示回数${a.impressions}回では判断できません（${MIN_IMP_PROVISIONAL}回以上で暫定評価）`,
      ],
    };
  }

  const ctr = a.clicks / a.impressions;
  const ctrIndex = Math.round((ctr / avgCtr) * 100);
  const cvr = a.conversions / a.impressions;
  const cvIndex = avgCvr > 0 ? Math.round((cvr / avgCvr) * 100) : null;

  // 指数100（広告内平均）を60点として、±1ポイントごとに0.5点
  let score = 60 + (ctrIndex - 100) * 0.5;
  notes.push(`CTRは広告内平均の${ctrIndex}%（${(ctr * 100).toFixed(2)}%）`);

  if (cvIndex !== null) {
    score += (cvIndex - 100) * 0.2;
    notes.push(`CV貢献は平均の${cvIndex}%`);
  } else if (a.conversions > 0) {
    score += 10;
    notes.push(`このアセットのみCV ${a.conversions.toFixed(1)}件`);
  }

  // Googleの評価も実績に基づくものなので加味する
  if (a.performanceLabel === "BEST") {
    score += 15;
    notes.push("Google評価「最良」");
  } else if (a.performanceLabel === "GOOD") {
    score += 5;
    notes.push("Google評価「良」");
  } else if (a.performanceLabel === "LOW") {
    score -= 20;
    notes.push("Google評価「低」");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const basis: ScoreBasis = a.impressions >= MIN_IMP_CONFIDENT ? "performance" : "provisional";
  if (basis === "provisional") notes.push(`表示${a.impressions}回のため暫定値`);

  return {
    score,
    grade: score >= 75 ? "A" : score >= 60 ? "B" : score >= 45 ? "C" : "D",
    basis,
    ctrIndex,
    cvIndex,
    notes,
  };
}

// 改善ボタンを出す閾値（これ未満なら手を入れる価値がある）
export const IMPROVE_THRESHOLD = 60;

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

  // 配信されていない＝Googleが評価を付けられない状態（NOT_APPLICABLE が大半）
  const rated = assets.filter((a) => ["BEST", "GOOD", "LOW"].includes(a.performanceLabel ?? ""));
  const textAssets = assets.filter((a) => ["HEADLINE", "DESCRIPTION"].includes(a.fieldType));
  if (textAssets.length > 0 && rated.length === 0) {
    const served = textAssets.filter((a) => a.impressions > 0).length;
    out.push({
      level: "info",
      title: "アセットの評価が付いていません（配信実績が無いため）",
      evidence: `見出し・説明文 ${textAssets.length}件のうち、Googleの評価（最良/良/低）が付いたものは0件。表示実績があるアセットは ${served}件です。`,
      action:
        served === 0
          ? "対象の検索キャンペーンが停止中の可能性があります。配信を再開すると2週間ほどで評価が付き、どの訴求が効いているか判断できるようになります。それまでは下の「AIで改善案を出す」でコピーの質（訴求の重複・不足している切り口）から改善できます。"
          : "配信量が少なく評価が確定していません。もう少しデータが貯まるまで待ってください。",
    });
  }

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

  // 入稿本数が不足（有効性が良好でも機会損失。手順書§7-D）
  const thinHead = creatives.filter((c) => c.headlineCount > 0 && c.headlineCount < 12);
  if (thinHead.length > 0) {
    out.push({
      level: "info",
      title: `見出しの本数が少ない広告が ${thinHead.length}件`,
      evidence: thinHead.slice(0, 4).map((c) => `${c.adGroupName}（${c.headlineCount}/15本）`).join("、"),
      action: "見出しは上限15本近くまで入れると組み合わせの探索範囲が広がります。関連性の低いものは入れず、訴求軸を変えた案を足してください。",
    });
  }
  // 説明文は4本が上限。2本以下は表示機会を捨てている
  const thinDesc = creatives.filter((c) => c.descriptionCount > 0 && c.descriptionCount <= 2);
  if (thinDesc.length > 0) {
    out.push({
      level: "warn",
      title: `説明文が上限の半分以下の広告が ${thinDesc.length}件`,
      evidence: thinDesc.slice(0, 4).map((c) => `${c.adGroupName}（${c.descriptionCount}/4本）`).join("、"),
      action: "説明文は4本まで入れられます。2本では組み合わせの幅が出ず、長い表示枠が使われないことがあります。異なる訴求（実績・保証・料金の明朗さなど）で2本追加してください。",
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
