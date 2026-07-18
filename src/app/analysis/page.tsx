import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getOrgContext } from "@/lib/auth-helpers";
import { PLATFORMS, isPlatformId } from "@/lib/platforms";

export const dynamic = "force-dynamic";

// 診断分析ページ: エキスパートの見方（結果→分解→機会→規律）をルールベースで自動診断。
// 判定閾値は運用ルール・手順書に準拠（CPA±15%分解 / CV0×消化 / 目標2倍 / +20%上限 / CV30件）。

interface Agg {
  costYen: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValueYen: number;
}
const zero = (): Agg => ({ costYen: 0, impressions: 0, clicks: 0, conversions: 0, conversionValueYen: 0 });
const add = (a: Agg, m: Agg) => {
  a.costYen += m.costYen;
  a.impressions += m.impressions;
  a.clicks += m.clicks;
  a.conversions += m.conversions;
  a.conversionValueYen += m.conversionValueYen;
};
const yen = (v: number) => `¥${Math.round(v).toLocaleString()}`;
const cpaOf = (a: Agg) => (a.conversions > 0 ? a.costYen / a.conversions : null);
const cpcOf = (a: Agg) => (a.clicks > 0 ? a.costYen / a.clicks : null);
const cvrOf = (a: Agg) => (a.clicks > 0 ? (a.conversions / a.clicks) * 100 : null);
const ctrOf = (a: Agg) => (a.impressions > 0 ? (a.clicks / a.impressions) * 100 : null);
const diffPct = (cur: number, prev: number) => ((cur - prev) / prev) * 100;
const fmtDiff = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;

type Level = "crit" | "warn" | "good" | "info";
interface Finding {
  level: Level;
  title: string;
  evidence: string; // このデータがこうだから
  action: string; // こうすべき
}

const LEVEL_STYLE: Record<Level, { chip: string; label: string; border: string }> = {
  crit: { chip: "bg-red-950 text-red-300 border border-red-900", label: "要対応", border: "border-l-red-500" },
  warn: { chip: "bg-amber-950 text-amber-300 border border-amber-900", label: "注意", border: "border-l-amber-500" },
  good: { chip: "bg-emerald-950 text-emerald-300 border border-emerald-900", label: "好機", border: "border-l-emerald-500" },
  info: { chip: "bg-neutral-800 text-gray-400", label: "情報", border: "border-l-neutral-600" },
};

export default async function AnalysisPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  const orgId = ctx.organizationId;

  const mid = new Date(Date.now() - 30 * 86400_000);
  const start = new Date(Date.now() - 60 * 86400_000);

  const [metrics, terms, recentChanges] = await Promise.all([
    prisma.dailyMetric.findMany({
      where: { organizationId: orgId, date: { gte: start } },
      select: {
        date: true,
        costYen: true,
        impressions: true,
        clicks: true,
        conversions: true,
        conversionValueYen: true,
        campaign: {
          select: {
            id: true,
            name: true,
            status: true,
            brandTag: true,
            dailyBudgetYen: true,
            connection: {
              select: { id: true, accountName: true, platform: true, mode: true, targetCpaYen: true, targetRoas: true },
            },
          },
        },
      },
    }),
    prisma.searchTerm.groupBy({
      by: ["connectionId", "aiVerdict"],
      where: { organizationId: orgId, status: "new" },
      _count: true,
      _sum: { costYen: true },
    }),
    prisma.changeLog.findMany({
      where: { organizationId: orgId, createdAt: { gte: new Date(Date.now() - 14 * 86400_000) } },
      select: { connectionId: true, detail: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // キャンペーン×期間（直近30日 / その前30日）で集計
  type Camp = {
    id: string;
    name: string;
    status: string;
    brandTag: string;
    dailyBudgetYen: number | null;
    conn: { id: string; accountName: string; platform: string; mode: string; targetCpaYen: number | null; targetRoas: number | null };
    cur: Agg;
    prev: Agg;
  };
  const camps = new Map<string, Camp>();
  for (const m of metrics) {
    const c = m.campaign;
    const row =
      camps.get(c.id) ??
      ({
        id: c.id,
        name: c.name,
        status: c.status,
        brandTag: c.brandTag,
        dailyBudgetYen: c.dailyBudgetYen,
        conn: c.connection,
        cur: zero(),
        prev: zero(),
      } as Camp);
    add(m.date >= mid ? row.cur : row.prev, m);
    camps.set(c.id, row);
  }

  // 接続単位の合計
  type ConnAgg = { conn: Camp["conn"]; cur: Agg; prev: Agg };
  const conns = new Map<string, ConnAgg>();
  for (const c of camps.values()) {
    const row = conns.get(c.conn.id) ?? { conn: c.conn, cur: zero(), prev: zero() };
    add(row.cur, c.cur);
    add(row.prev, c.prev);
    conns.set(c.conn.id, row);
  }

  // ── 診断ルール ──────────────────────────────────────
  const findings: Finding[] = [];

  // 1. 結果判定（接続単位: 目標CPA/ROAS・CV数トレンド）
  for (const { conn, cur, prev } of conns.values()) {
    const cpa = cpaOf(cur);
    if (conn.targetCpaYen && cpa !== null) {
      if (cpa > conn.targetCpaYen * 2) {
        findings.push({
          level: "crit",
          title: `${conn.accountName}: CPAが目標の2倍超`,
          evidence: `実績CPA ${yen(cpa)} が目標 ${yen(conn.targetCpaYen)} の2倍を超過（直近30日）。`,
          action: "変更ログと外部要因（競合・季節・LP障害）を確認し、原因特定まで予算増額を凍結（手順書§9）。下の分解診断でCPC要因かCVR要因かを確認。",
        });
      } else if (cpa <= conn.targetCpaYen * 0.7 && cur.conversions >= 3) {
        findings.push({
          level: "good",
          title: `${conn.accountName}: 目標CPAを大幅達成 — 拡大余地`,
          evidence: `実績CPA ${yen(cpa)}（目標 ${yen(conn.targetCpaYen)} の${Math.round((cpa / conn.targetCpaYen) * 100)}%）・CV ${cur.conversions.toFixed(1)}件。`,
          action: "好調キャンペーンの日予算を+20%以内で増額（1回の変更はこれのみ・2週間観察）。インプレッションシェアの損失が予算起因か確認できればさらに確度が上がる。",
        });
      }
    }
    if (prev.conversions >= 3 && cur.conversions < prev.conversions * 0.7) {
      findings.push({
        level: "warn",
        title: `${conn.accountName}: CV数が前期比で大幅減`,
        evidence: `CV ${prev.conversions.toFixed(1)} → ${cur.conversions.toFixed(1)}件（${fmtDiff(diffPct(cur.conversions, prev.conversions))}）。`,
        action: "効率(CPA)より先に件数の減少要因を特定。表示回数も減っていれば配信量（予算・ランク）、表示は維持でCVだけ減ならLP・計測を疑う。",
      });
    }
  }

  // 2. 分解診断（キャンペーン単位: CPA = CPC ÷ CVR）
  for (const c of [...camps.values()].sort((a, b) => b.cur.costYen - a.cur.costYen)) {
    if (c.status !== "active" || c.cur.costYen < 1000) continue;
    const label = isPlatformId(c.conn.platform) ? PLATFORMS[c.conn.platform].short : c.conn.platform;
    const name = `[${label}] ${c.name}`;

    // CV0で消化
    if (c.cur.conversions === 0 && c.cur.costYen >= 3000) {
      const ctr = ctrOf(c.cur);
      findings.push({
        level: "crit",
        title: `${name}: CV0のまま ${yen(c.cur.costYen)} を消化`,
        evidence: `クリック${c.cur.clicks}件${ctr !== null ? `・CTR ${ctr.toFixed(1)}%` : ""}を集めてCV0（直近30日）。クリックは取れている＝集客はできている。`,
        action: "①まずCV計測タグの発火を確認（成果悪化と決めつけない） ②運用チェックで無駄語句を除外 ③それでもCV0なら訴求とLPの不一致を疑い、日予算の減額または停止を検討。",
      });
      continue;
    }

    // CPA悪化の分解
    const curCpa = cpaOf(c.cur);
    const prevCpa = cpaOf(c.prev);
    if (curCpa !== null && prevCpa !== null && curCpa > prevCpa * 1.15) {
      const curCpc = cpcOf(c.cur);
      const prevCpc = cpcOf(c.prev);
      const curCvr = cvrOf(c.cur);
      const prevCvr = cvrOf(c.prev);
      const cpcUp = curCpc !== null && prevCpc !== null && curCpc > prevCpc * 1.15;
      const cvrDown = curCvr !== null && prevCvr !== null && curCvr < prevCvr * 0.85;
      if (cpcUp && !cvrDown) {
        findings.push({
          level: "warn",
          title: `${name}: CPA悪化の主因は「CPC上昇」`,
          evidence: `CPA ${yen(prevCpa)}→${yen(curCpa)}（${fmtDiff(diffPct(curCpa, prevCpa))}）。CPC ${yen(prevCpc!)}→${yen(curCpc!)}（${fmtDiff(diffPct(curCpc!, prevCpc!))}）でCVR ${prevCvr?.toFixed(1)}%→${curCvr?.toFixed(1)}% は維持。`,
          action: "入札・競合要因。オークション分析で競合の重複率を確認し、品質（広告文とKWの関連性）を改善。tCPA調整は±20%以内で1回だけ。",
        });
      } else if (cvrDown) {
        findings.push({
          level: "warn",
          title: `${name}: CPA悪化の主因は「CVR低下」`,
          evidence: `CPA ${yen(prevCpa)}→${yen(curCpa)}（${fmtDiff(diffPct(curCpa, prevCpa))}）。CVR ${prevCvr!.toFixed(2)}%→${curCvr!.toFixed(2)}%（CPCは${cpcUp ? "上昇" : "維持"}）。`,
          action: "広告ではなくLP・フォーム・計測側の問題の可能性が高い。GA4のランディングページ実績（直帰・エンゲージ）で切り分け → LP改善 or タグ点検。入札は触らない。",
        });
      } else {
        findings.push({
          level: "info",
          title: `${name}: CPAが悪化（要観察）`,
          evidence: `CPA ${yen(prevCpa)}→${yen(curCpa)}（${fmtDiff(diffPct(curCpa, prevCpa))}）。CPC/CVRの単独犯は特定できず。`,
          action: "CV件数が少ない可能性。CV30件貯まるまで断定せず観察を継続。",
        });
      }
    }

    // CTR高×CVR低（LP不一致シグナル）
    const ctr = ctrOf(c.cur);
    const cvr = cvrOf(c.cur);
    if (ctr !== null && cvr !== null && ctr >= 5 && cvr < 1 && c.cur.clicks >= 50) {
      findings.push({
        level: "warn",
        title: `${name}: CTRは高いがCVRが低い（広告とLPの不一致）`,
        evidence: `CTR ${ctr.toFixed(1)}%（クリックさせる力はある）に対しCVR ${cvr.toFixed(2)}%。`,
        action: "広告が立てた「約束」をLPが果たせていない典型パターン。広告文の訴求とLPのファーストビューを揃える。GA4で直帰率を確認。",
      });
    }
  }

  // 3. 機会（検索語句の除外・昇格）
  const connName = (id: string) => [...conns.values()].find((c) => c.conn.id === id)?.conn.accountName ?? "";
  for (const t of terms) {
    if (t.aiVerdict === "exclude" && t._count > 0) {
      findings.push({
        level: "good",
        title: `${connName(t.connectionId)}: 除外推奨の検索語句が ${t._count}件`,
        evidence: `AI判定「除外推奨」の未処理語句に合計 ${yen(t._sum.costYen ?? 0)} を消化中。`,
        action: "運用チェック →「除外推奨を一括除外」で無駄消化を止める（CV0のみ・完全一致で安全に登録）。自動除外トグルをONにすれば毎週自動化。",
      });
    }
    if (t.aiVerdict === "promote" && t._count > 0) {
      findings.push({
        level: "good",
        title: `${connName(t.connectionId)}: 昇格候補の検索語句が ${t._count}件`,
        evidence: `CVが出ており完全一致キーワード化で強化できる語句が残っています。`,
        action: "運用チェックの語句テーブルで「昇格」ボタンから正式登録（CV2件以上が対象）。",
      });
    }
  }

  // 4. 規律（学習期間・データ量・指名分離）
  const changesByConn = new Map<string, { count: number; latest: string }>();
  for (const ch of recentChanges) {
    const e = changesByConn.get(ch.connectionId) ?? { count: 0, latest: ch.detail };
    e.count++;
    changesByConn.set(ch.connectionId, e);
  }
  for (const [connId, e] of changesByConn) {
    findings.push({
      level: "info",
      title: `${connName(connId)}: 学習期間中（直近14日に${e.count}件の変更）`,
      evidence: `最新の変更: ${e.latest}`,
      action: "この間の追加変更（入札・予算・構造）は学習をリセットする恐れ。2週間 or 新規CV50件までは1変更ずつ。効果は変更ログの14日後自動検証で確認。",
    });
  }
  const totalCv = [...conns.values()].reduce((a, c) => a + c.cur.conversions, 0);
  if (totalCv > 0 && totalCv < 30) {
    findings.push({
      level: "info",
      title: `データ量注意: 直近30日のCVは${totalCv.toFixed(1)}件`,
      evidence: "CV30件未満（理想50件）では優劣の断定は統計的に危険。",
      action: "上の診断は「傾向」として扱い、大きな構造変更はCV蓄積を待ってから。",
    });
  }

  const order: Level[] = ["crit", "warn", "good", "info"];
  findings.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
  const counts = Object.fromEntries(order.map((l) => [l, findings.filter((f) => f.level === l).length]));

  // ── 表示 ────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-black text-gray-100">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-xl font-bold text-white">診断分析</h1>
          <span className="text-xs text-gray-500">直近30日 vs その前30日 ・ 手順書の閾値で自動判定</span>
          <a href="/" className="ml-auto text-sm text-gray-400 hover:text-white">← ダッシュボード</a>
        </div>
        <p className="text-xs text-gray-500 mb-6">
          見方: 結果（目標対比）→ 分解（CPA=CPC÷CVR で犯人特定）→ 機会（語句）→ 規律（学習期間・データ量）
        </p>

        <div className="flex gap-2 mb-6">
          {order.map((l) => (
            <span key={l} className={`text-xs px-2.5 py-1 rounded-full ${LEVEL_STYLE[l].chip}`}>
              {LEVEL_STYLE[l].label} {counts[l]}
            </span>
          ))}
        </div>

        {findings.length === 0 ? (
          <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-8 text-center text-gray-500 text-sm">
            診断対象のデータがまだありません。媒体を接続して実績が貯まると、ここに診断結果と提案が表示されます。
          </div>
        ) : (
          <div className="space-y-3">
            {findings.map((f, i) => (
              <div key={i} className={`bg-neutral-950 border border-neutral-800 border-l-4 ${LEVEL_STYLE[f.level].border} rounded-lg p-4`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${LEVEL_STYLE[f.level].chip}`}>
                    {LEVEL_STYLE[f.level].label}
                  </span>
                  <h2 className="text-sm font-semibold text-white">{f.title}</h2>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  <span className="text-gray-600">データ: </span>
                  {f.evidence}
                </p>
                <p className="text-xs text-sky-300 leading-relaxed mt-1">
                  <span className="text-sky-600">提案: </span>
                  {f.action}
                </p>
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] text-gray-600 mt-8">
          この診断はルールベース（即時・毎回同じ基準）です。より深い文脈込みの分析は AIインサイトの「レポート生成」を、
          提出用の資料は「クライアントレポート」を使ってください。
        </p>
      </div>
    </div>
  );
}
