import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getOrgContext } from "@/lib/auth-helpers";
import { buildMetricsSummary } from "@/lib/insights";
import { PLATFORMS, isPlatformId } from "@/lib/platforms";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

// クライアント提出用レポート（スライド型プレビュー + 印刷でPDF化）
// A4横（1122x793px ≒ 297x210mm）を1スライドとし、AI分析は流し込みページで続ける。

const yen = (v: number) => `¥${Math.round(v).toLocaleString()}`;
const num = (v: number) => Math.round(v).toLocaleString();

function derived(k: { costYen: number; impressions: number; clicks: number; conversions: number; conversionValueYen: number }) {
  return {
    ctr: k.impressions ? (k.clicks / k.impressions) * 100 : 0,
    cpc: k.clicks ? k.costYen / k.clicks : 0,
    cpa: k.conversions ? k.costYen / k.conversions : null,
    roas: k.costYen ? (k.conversionValueYen / k.costYen) * 100 : 0,
  };
}

function pctDiff(cur: number, prev?: number | null): string | null {
  if (!prev) return null;
  const d = ((cur - prev) / prev) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(0)}%`;
}

// AIレポート（Markdown）の簡易描画: ## 見出し / 箇条書き / **太字**
function Md({ body }: { body: string }) {
  const bold = (t: string, key: number) => (
    <span key={key}>
      {t.split("**").map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : p))}
    </span>
  );
  return (
    <>
      {body.split("\n").map((line, i) => {
        const t = line.trim();
        if (!t) return null;
        if (t.startsWith("## ")) return <h3 key={i} className="md-h">{t.slice(3)}</h3>;
        if (t.startsWith("# ")) return <h3 key={i} className="md-h">{t.slice(2)}</h3>;
        if (/^[-・]\s/.test(t)) return <li key={i} className="md-li">{bold(t.replace(/^[-・]\s/, ""), i)}</li>;
        if (/^\d+\.\s/.test(t)) return <li key={i} className="md-li">{bold(t, i)}</li>;
        return <p key={i} className="md-p">{bold(t, i)}</p>;
      })}
    </>
  );
}

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  const sp = await searchParams;
  const days = sp.days === "7" || sp.days === "90" ? Number(sp.days) : 30;

  const [org, summary, insight, actions] = await Promise.all([
    prisma.organization.findUnique({ where: { id: ctx.organizationId }, select: { name: true } }),
    buildMetricsSummary(ctx.organizationId, days),
    prisma.insight.findFirst({
      where: { organizationId: ctx.organizationId, kind: "recommendation" },
      orderBy: { createdAt: "desc" },
      select: { title: true, body: true, createdAt: true },
    }),
    prisma.changeLog.findMany({
      where: { organizationId: ctx.organizationId, createdAt: { gte: new Date(Date.now() - days * 86400_000) } },
      orderBy: { createdAt: "desc" },
      take: 14,
    }),
  ]);

  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const period = summary
    ? `${summary.periodStart.toISOString().slice(0, 10)} 〜 ${summary.periodEnd.toISOString().slice(0, 10)}`
    : "-";
  const d = summary ? derived(summary.total) : null;

  const kpis = summary && d
    ? [
        { label: "広告費用", value: yen(summary.total.costYen), diff: pctDiff(summary.total.costYen, summary.prevTotal?.costYen) },
        { label: "表示回数", value: num(summary.total.impressions), diff: pctDiff(summary.total.impressions, summary.prevTotal?.impressions) },
        { label: "クリック", value: num(summary.total.clicks), diff: pctDiff(summary.total.clicks, summary.prevTotal?.clicks) },
        { label: "コンバージョン", value: summary.total.conversions.toFixed(1), diff: pctDiff(summary.total.conversions, summary.prevTotal?.conversions) },
        { label: "CPA", value: d.cpa ? yen(d.cpa) : "—", diff: null },
        { label: "ROAS", value: `${d.roas.toFixed(0)}%`, diff: null },
      ]
    : [];

  return (
    <div className="report-root">
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{`
        .report-root{background:#3b4351;min-height:100vh;padding:20px 0 60px;font-family:"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic UI",Meiryo,sans-serif;}
        .toolbar{max-width:1122px;margin:0 auto 14px;display:flex;align-items:center;gap:14px;color:#cdd3dd;font-size:13px;padding:0 8px;}
        .tb-btn{background:#0369a1;color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:14px;font-weight:700;cursor:pointer;}
        .tb-btn:hover{background:#075985;}
        .tb-link{color:#9fb3c8;text-decoration:none;}
        .tb-hint{font-size:11px;color:#8b94a3;}
        .slide{width:1122px;min-height:793px;background:#fff;color:#1c2733;margin:0 auto 24px;box-shadow:0 6px 30px rgba(0,0,0,.35);padding:56px 64px;box-sizing:border-box;display:flex;flex-direction:column;page-break-after:always;position:relative;}
        .slide.fixed{height:793px;overflow:hidden;}
        .brand{position:absolute;bottom:28px;right:64px;font-size:11px;color:#8fa1b3;letter-spacing:.1em;}
        .pageno{position:absolute;bottom:28px;left:64px;font-size:11px;color:#8fa1b3;}
        .eyebrow{color:#0369a1;font-weight:700;letter-spacing:.18em;font-size:13px;}
        .cover-title{font-size:44px;font-weight:800;margin:.4em 0 .2em;line-height:1.3;}
        .cover-sub{font-size:18px;color:#5b6b7c;}
        .cover-meta{margin-top:auto;font-size:14px;color:#5b6b7c;line-height:2;}
        .s-title{font-size:26px;font-weight:800;border-left:6px solid #0369a1;padding-left:14px;margin:0 0 24px;}
        .kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;}
        .kpi{border:1px solid #dbe4ec;border-radius:12px;padding:20px 22px;}
        .kpi .l{font-size:13px;color:#5b6b7c;}
        .kpi .v{font-size:32px;font-weight:800;margin-top:4px;font-variant-numeric:tabular-nums;}
        .kpi .d{font-size:13px;margin-top:4px;color:#047857;font-weight:700;}
        .kpi .d.neg{color:#b91c1c;}
        table.rp{width:100%;border-collapse:collapse;font-size:13.5px;font-variant-numeric:tabular-nums;}
        table.rp th{background:#eef4f9;color:#334455;font-weight:700;text-align:right;padding:9px 12px;border-bottom:2px solid #c9d6e2;}
        table.rp th:first-child,table.rp td:first-child{text-align:left;}
        table.rp td{padding:8px 12px;border-bottom:1px solid #e4ebf2;text-align:right;white-space:nowrap;}
        table.rp td:first-child{white-space:normal;}
        .note{font-size:12px;color:#8fa1b3;margin-top:14px;}
        .md-h{font-size:19px;font-weight:800;color:#0f3b57;border-bottom:2px solid #dbe4ec;padding-bottom:6px;margin:22px 0 10px;}
        .md-p,.md-li{font-size:14px;line-height:1.9;margin:.35em 0;}
        .md-li{list-style:none;padding-left:1.1em;text-indent:-1.1em;}
        .md-li::before{content:"▸ ";color:#0369a1;}
        @media print{
          .no-print{display:none!important;}
          .report-root{background:#fff;padding:0;}
          .slide{box-shadow:none;margin:0;width:auto;min-height:0;}
          .slide.fixed{height:auto;min-height:180mm;}
          @page{size:A4 landscape;margin:8mm;}
        }
        @media (max-width:1160px){.slide{width:100%;min-height:0;height:auto!important;padding:32px;}}
      `}</style>

      <PrintButton />

      {/* 表紙 */}
      <section className="slide fixed">
        <p className="eyebrow">MONTHLY AD PERFORMANCE REPORT</p>
        <h1 className="cover-title">広告運用レポート</h1>
        <p className="cover-sub">{org?.name ?? ""} 御中</p>
        <div className="cover-meta">
          対象期間: {period}（直近{days}日）<br />
          発行日: {today}<br />
          対象媒体: {summary?.byPlatform.map((p) => p.label).join(" / ") || "—"}
        </div>
        <span className="brand">Powered by Ad Agent</span>
      </section>

      {/* KPIサマリー */}
      <section className="slide fixed">
        <h2 className="s-title">全体サマリー</h2>
        <div className="kpi-grid">
          {kpis.map((k) => (
            <div className="kpi" key={k.label}>
              <div className="l">{k.label}</div>
              <div className="v">{k.value}</div>
              {k.diff && <div className={`d${k.diff.startsWith("-") ? " neg" : ""}`}>前期比 {k.diff}</div>}
            </div>
          ))}
        </div>
        <p className="note">前期比は直前の同じ長さの期間（{days}日間）との比較です。</p>
        <span className="pageno">02</span>
        <span className="brand">Powered by Ad Agent</span>
      </section>

      {/* 媒体別 */}
      <section className="slide fixed">
        <h2 className="s-title">媒体別パフォーマンス</h2>
        <table className="rp">
          <thead>
            <tr><th>媒体</th><th>費用</th><th>表示</th><th>クリック</th><th>CTR</th><th>CPC</th><th>CV</th><th>CPA</th><th>ROAS</th></tr>
          </thead>
          <tbody>
            {summary?.byPlatform.map((p) => {
              const x = derived(p);
              return (
                <tr key={p.platform}>
                  <td>{p.label}</td>
                  <td>{yen(p.costYen)}</td>
                  <td>{num(p.impressions)}</td>
                  <td>{num(p.clicks)}</td>
                  <td>{x.ctr.toFixed(2)}%</td>
                  <td>{yen(x.cpc)}</td>
                  <td>{p.conversions.toFixed(1)}</td>
                  <td>{x.cpa ? yen(x.cpa) : "—"}</td>
                  <td>{x.roas.toFixed(0)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <span className="pageno">03</span>
        <span className="brand">Powered by Ad Agent</span>
      </section>

      {/* キャンペーン別 */}
      <section className="slide fixed">
        <h2 className="s-title">キャンペーン別パフォーマンス（費用上位）</h2>
        <table className="rp">
          <thead>
            <tr><th>キャンペーン</th><th>媒体</th><th>費用</th><th>クリック</th><th>CV</th><th>CPA</th><th>ROAS</th></tr>
          </thead>
          <tbody>
            {summary?.byCampaign.slice(0, 12).map((c, i) => {
              const x = derived(c);
              return (
                <tr key={i}>
                  <td>{c.name}</td>
                  <td>{isPlatformId(c.platform) ? PLATFORMS[c.platform].short : c.platform}</td>
                  <td>{yen(c.costYen)}</td>
                  <td>{num(c.clicks)}</td>
                  <td>{c.conversions.toFixed(1)}</td>
                  <td>{x.cpa ? yen(x.cpa) : "—"}</td>
                  <td>{x.roas.toFixed(0)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <span className="pageno">04</span>
        <span className="brand">Powered by Ad Agent</span>
      </section>

      {/* AI分析（流し込み・複数ページ可） */}
      {insight && (
        <section className="slide">
          <h2 className="s-title">分析と改善提案</h2>
          <Md body={insight.body} />
          <p className="note">分析生成: {insight.createdAt.toISOString().slice(0, 10)}（{insight.title}）</p>
          <span className="brand">Powered by Ad Agent</span>
        </section>
      )}

      {/* 実施アクション */}
      {actions.length > 0 && (
        <section className="slide">
          <h2 className="s-title">期間中に実施した施策（変更ログ）</h2>
          <table className="rp">
            <thead><tr><th>日付</th><th>内容</th><th>実行</th><th>効果検証</th></tr></thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.id}>
                  <td>{a.createdAt.toISOString().slice(0, 10)}</td>
                  <td style={{ textAlign: "left", whiteSpace: "normal" }}>{a.detail}</td>
                  <td>{a.actor === "auto" ? "自動" : "手動"}</td>
                  <td style={{ textAlign: "left", whiteSpace: "normal" }}>{a.verdict ?? "検証待ち（14日後に自動検証）"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <span className="brand">Powered by Ad Agent</span>
        </section>
      )}
    </div>
  );
}
