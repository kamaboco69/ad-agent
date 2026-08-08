import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { PLATFORMS, isPlatformId } from "@/lib/platforms";
import { computePacing, PACING_LABEL } from "@/lib/pacing";

// クライアント提出用の Excel / PowerPoint を組み立てる。
// PDF（印刷）は既存の /report。こちらは「数字を触れる形」「報告会で映す形」で渡すためのもの。

export interface ExportData {
  clientName: string;
  agencyName: string | null;
  accentColor: string;
  periodLabel: string;
  totals: { costYen: number; impressions: number; clicks: number; conversions: number; conversionValueYen: number };
  daily: { date: string; costYen: number; clicks: number; conversions: number }[];
  byPlatform: { label: string; costYen: number; impressions: number; clicks: number; conversions: number; conversionValueYen: number }[];
  byCampaign: { name: string; status: string; costYen: number; clicks: number; conversions: number; conversionValueYen: number }[];
  pacing: { statusLabel: string; mtdYen: number; monthlyBudgetYen: number | null; forecastYen: number; recommendedDailyYen: number | null };
  insightBody: string | null;
  actions: { at: string; detail: string; actor: string; verdict: string | null }[];
}

const derived = (k: { costYen: number; impressions: number; clicks: number; conversions: number; conversionValueYen: number }) => ({
  ctr: k.impressions > 0 ? k.clicks / k.impressions : 0,
  cpc: k.clicks > 0 ? k.costYen / k.clicks : 0,
  cpa: k.conversions > 0 ? k.costYen / k.conversions : null,
  roas: k.costYen > 0 ? k.conversionValueYen / k.costYen : 0,
});

// 接続1件分のレポート素材を集める
export async function buildExportData(organizationId: string, connectionId: string, days = 30): Promise<ExportData> {
  const since = new Date(Date.now() - days * 86400_000);
  const jst = new Date(Date.now() + 9 * 3600_000);
  const monthStart = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1));

  const [conn, tpl, metrics, mtd, insight, changes] = await Promise.all([
    prisma.adConnection.findUniqueOrThrow({ where: { id: connectionId } }),
    prisma.reportTemplate.findUnique({ where: { connectionId } }),
    prisma.dailyMetric.findMany({
      where: { organizationId, date: { gte: since }, campaign: { connectionId } },
      select: {
        date: true, costYen: true, impressions: true, clicks: true, conversions: true, conversionValueYen: true,
        campaign: { select: { name: true, status: true, connection: { select: { platform: true } } } },
      },
      orderBy: { date: "asc" },
    }),
    prisma.dailyMetric.findMany({
      where: { organizationId, date: { gte: monthStart }, campaign: { connectionId } },
      select: { date: true, costYen: true },
      orderBy: { date: "asc" },
    }),
    prisma.insight.findFirst({
      where: { organizationId, kind: "recommendation" },
      orderBy: { createdAt: "desc" },
      select: { body: true },
    }),
    prisma.changeLog.findMany({
      where: { organizationId, connectionId, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const totals = { costYen: 0, impressions: 0, clicks: 0, conversions: 0, conversionValueYen: 0 };
  const dailyMap = new Map<string, { date: string; costYen: number; clicks: number; conversions: number }>();
  const platMap = new Map<string, ExportData["byPlatform"][number]>();
  const campMap = new Map<string, ExportData["byCampaign"][number]>();

  for (const m of metrics) {
    totals.costYen += m.costYen;
    totals.impressions += m.impressions;
    totals.clicks += m.clicks;
    totals.conversions += m.conversions;
    totals.conversionValueYen += m.conversionValueYen;

    const dk = m.date.toISOString().slice(0, 10);
    const d = dailyMap.get(dk) ?? { date: dk, costYen: 0, clicks: 0, conversions: 0 };
    d.costYen += m.costYen;
    d.clicks += m.clicks;
    d.conversions += m.conversions;
    dailyMap.set(dk, d);

    const pf = m.campaign.connection.platform;
    const label = isPlatformId(pf) ? PLATFORMS[pf].label : pf;
    const p = platMap.get(label) ?? { label, costYen: 0, impressions: 0, clicks: 0, conversions: 0, conversionValueYen: 0 };
    p.costYen += m.costYen;
    p.impressions += m.impressions;
    p.clicks += m.clicks;
    p.conversions += m.conversions;
    p.conversionValueYen += m.conversionValueYen;
    platMap.set(label, p);

    const c = campMap.get(m.campaign.name) ?? {
      name: m.campaign.name, status: m.campaign.status, costYen: 0, clicks: 0, conversions: 0, conversionValueYen: 0,
    };
    c.costYen += m.costYen;
    c.clicks += m.clicks;
    c.conversions += m.conversions;
    c.conversionValueYen += m.conversionValueYen;
    campMap.set(m.campaign.name, c);
  }

  const pacing = computePacing({ monthlyBudgetYen: conn.monthlyBudgetYen, mtdDaily: mtd });
  const end = new Date().toISOString().slice(0, 10);
  const start = since.toISOString().slice(0, 10);

  return {
    clientName: tpl?.clientName || conn.accountName,
    agencyName: tpl?.agencyName ?? null,
    accentColor: (tpl?.accentColor || "#0369a1").replace("#", ""),
    periodLabel: `${start} 〜 ${end}`,
    totals,
    daily: [...dailyMap.values()],
    byPlatform: [...platMap.values()].sort((a, b) => b.costYen - a.costYen),
    byCampaign: [...campMap.values()].sort((a, b) => b.costYen - a.costYen),
    pacing: {
      statusLabel: PACING_LABEL[pacing.status],
      mtdYen: pacing.mtdYen,
      monthlyBudgetYen: pacing.monthlyBudgetYen,
      forecastYen: pacing.forecastYen,
      recommendedDailyYen: pacing.recommendedDailyYen,
    },
    insightBody: (tpl?.showInsight ?? true) ? insight?.body ?? null : null,
    actions: (tpl?.showActions ?? true)
      ? changes.map((c) => ({
          at: c.createdAt.toISOString().slice(0, 10),
          detail: c.detail,
          actor: c.actor === "auto" ? "自動" : "手動",
          verdict: c.verdict,
        }))
      : [],
  };
}

// ── Excel ───────────────────────────────────────────

export async function buildXlsx(d: ExportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = d.agencyName ?? "Ad Agent";
  const accent = d.accentColor;

  const header = (ws: ExcelJS.Worksheet, cols: string[]) => {
    const row = ws.addRow(cols);
    row.eachCell((c) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${accent}` } };
      c.alignment = { vertical: "middle" };
    });
    row.height = 20;
  };
  const yenFmt = '"¥"#,##0';

  // サマリー
  const s = wb.addWorksheet("サマリー");
  s.columns = [{ width: 22 }, { width: 20 }, { width: 20 }];
  s.addRow([`${d.clientName} 御中 広告レポート`]).font = { bold: true, size: 14 };
  s.addRow([`対象期間: ${d.periodLabel}`]);
  if (d.agencyName) s.addRow([`作成: ${d.agencyName}`]);
  s.addRow([]);
  const t = derived(d.totals);
  header(s, ["指標", "実績", "補足"]);
  const rows: [string, number | string, string][] = [
    ["広告費用", d.totals.costYen, ""],
    ["表示回数", d.totals.impressions, ""],
    ["クリック", d.totals.clicks, `CTR ${(t.ctr * 100).toFixed(2)}%`],
    ["クリック単価", Math.round(t.cpc), ""],
    ["コンバージョン", Number(d.totals.conversions.toFixed(1)), ""],
    ["獲得単価(CPA)", t.cpa ? Math.round(t.cpa) : "—", ""],
    ["ROAS", `${Math.round(t.roas * 100)}%`, `CV価値 ¥${d.totals.conversionValueYen.toLocaleString()}`],
  ];
  for (const [k, v, note] of rows) {
    const r = s.addRow([k, v, note]);
    if (typeof v === "number" && /費用|単価/.test(k)) r.getCell(2).numFmt = yenFmt;
    else if (typeof v === "number") r.getCell(2).numFmt = "#,##0";
  }
  s.addRow([]);
  header(s, ["予算進捗", "", ""]);
  s.addRow(["状態", d.pacing.statusLabel, ""]);
  s.addRow(["今月の消化", d.pacing.mtdYen, ""]).getCell(2).numFmt = yenFmt;
  s.addRow(["月予算", d.pacing.monthlyBudgetYen ?? "未設定", ""]).getCell(2).numFmt = yenFmt;
  s.addRow(["着地予想", d.pacing.forecastYen, ""]).getCell(2).numFmt = yenFmt;
  if (d.pacing.recommendedDailyYen !== null) {
    s.addRow(["日予算の目安", d.pacing.recommendedDailyYen, "残日数で均等配分"]).getCell(2).numFmt = yenFmt;
  }

  // 日別
  const dayWs = wb.addWorksheet("日別");
  dayWs.columns = [{ width: 14 }, { width: 14 }, { width: 12 }, { width: 12 }, { width: 14 }];
  header(dayWs, ["日付", "費用", "クリック", "CV", "CPA"]);
  for (const r of d.daily) {
    const row = dayWs.addRow([r.date, r.costYen, r.clicks, Number(r.conversions.toFixed(1)), r.conversions > 0 ? Math.round(r.costYen / r.conversions) : ""]);
    row.getCell(2).numFmt = yenFmt;
    row.getCell(5).numFmt = yenFmt;
  }

  // 媒体別
  const pw = wb.addWorksheet("媒体別");
  pw.columns = [{ width: 22 }, { width: 14 }, { width: 12 }, { width: 12 }, { width: 10 }, { width: 12 }, { width: 10 }, { width: 14 }, { width: 10 }];
  header(pw, ["媒体", "費用", "表示", "クリック", "CTR", "CPC", "CV", "CPA", "ROAS"]);
  for (const p of d.byPlatform) {
    const x = derived(p);
    const row = pw.addRow([p.label, p.costYen, p.impressions, p.clicks, x.ctr, Math.round(x.cpc), Number(p.conversions.toFixed(1)), x.cpa ? Math.round(x.cpa) : "", x.roas]);
    row.getCell(2).numFmt = yenFmt;
    row.getCell(5).numFmt = "0.00%";
    row.getCell(6).numFmt = yenFmt;
    row.getCell(8).numFmt = yenFmt;
    row.getCell(9).numFmt = "0%";
  }

  // キャンペーン別
  const cw = wb.addWorksheet("キャンペーン別");
  cw.columns = [{ width: 40 }, { width: 10 }, { width: 14 }, { width: 12 }, { width: 10 }, { width: 14 }, { width: 10 }];
  header(cw, ["キャンペーン", "状態", "費用", "クリック", "CV", "CPA", "ROAS"]);
  for (const c of d.byCampaign) {
    const x = derived({ ...c, impressions: 0 });
    const row = cw.addRow([c.name, c.status === "active" ? "配信中" : "停止中", c.costYen, c.clicks, Number(c.conversions.toFixed(1)), x.cpa ? Math.round(x.cpa) : "", x.roas]);
    row.getCell(3).numFmt = yenFmt;
    row.getCell(6).numFmt = yenFmt;
    row.getCell(7).numFmt = "0%";
  }

  // 実施施策
  if (d.actions.length > 0) {
    const aw = wb.addWorksheet("実施施策");
    aw.columns = [{ width: 14 }, { width: 60 }, { width: 10 }, { width: 50 }];
    header(aw, ["日付", "内容", "実行", "効果検証"]);
    for (const a of d.actions) aw.addRow([a.at, a.detail, a.actor, a.verdict ?? "検証待ち"]);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── PowerPoint ──────────────────────────────────────

// pptxgenjs のテーブルは行をセルオブジェクトの配列で受け取る
const cells = (row: (string | number)[]) => row.map((text) => ({ text: String(text) }));

export async function buildPptx(d: ExportData): Promise<Buffer> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const p = new PptxGenJS();
  p.layout = "LAYOUT_16x9";
  const accent = d.accentColor;
  const t = derived(d.totals);
  const yen = (v: number) => `¥${Math.round(v).toLocaleString()}`;

  // 表紙
  const cover = p.addSlide();
  cover.background = { color: "FFFFFF" };
  cover.addShape("rect", { x: 0, y: 0, w: 0.35, h: 5.63, fill: { color: accent } });
  cover.addText("広告運用レポート", { x: 0.9, y: 1.9, fontSize: 34, bold: true, color: "1C2733" });
  cover.addText(`${d.clientName} 御中`, { x: 0.95, y: 2.7, fontSize: 18, color: "5B6B7C" });
  cover.addText(`対象期間: ${d.periodLabel}`, { x: 0.95, y: 3.2, fontSize: 12, color: "8FA1B3" });
  if (d.agencyName) cover.addText(d.agencyName, { x: 0.95, y: 4.6, fontSize: 12, color: "5B6B7C" });

  // サマリー
  const s = p.addSlide();
  s.addText("全体サマリー", { x: 0.5, y: 0.35, fontSize: 22, bold: true, color: "1C2733" });
  s.addShape("rect", { x: 0.5, y: 0.95, w: 1.4, h: 0.05, fill: { color: accent } });
  const tiles: [string, string][] = [
    ["広告費用", yen(d.totals.costYen)],
    ["表示回数", d.totals.impressions.toLocaleString()],
    ["クリック", `${d.totals.clicks.toLocaleString()}（CTR ${(t.ctr * 100).toFixed(2)}%）`],
    ["コンバージョン", d.totals.conversions.toFixed(1)],
    ["獲得単価(CPA)", t.cpa ? yen(t.cpa) : "—"],
    ["ROAS", `${Math.round(t.roas * 100)}%`],
  ];
  tiles.forEach(([label, value], i) => {
    const x = 0.5 + (i % 3) * 3.05;
    const y = 1.3 + Math.floor(i / 3) * 1.5;
    s.addShape("roundRect", { x, y, w: 2.85, h: 1.25, fill: { color: "F7F9FB" }, line: { color: "DBE4EC", width: 1 } });
    s.addText(label, { x: x + 0.15, y: y + 0.15, fontSize: 10, color: "5B6B7C" });
    s.addText(value, { x: x + 0.15, y: y + 0.5, fontSize: 20, bold: true, color: "1C2733" });
  });
  s.addText(
    `予算進捗: ${d.pacing.statusLabel}｜今月の消化 ${yen(d.pacing.mtdYen)}${d.pacing.monthlyBudgetYen ? ` / 月予算 ${yen(d.pacing.monthlyBudgetYen)}` : ""}｜着地予想 ${yen(d.pacing.forecastYen)}`,
    { x: 0.5, y: 4.5, fontSize: 11, color: "5B6B7C" }
  );

  // 媒体別
  if (d.byPlatform.length > 0) {
    const ps = p.addSlide();
    ps.addText("媒体別パフォーマンス", { x: 0.5, y: 0.35, fontSize: 22, bold: true, color: "1C2733" });
    ps.addShape("rect", { x: 0.5, y: 0.95, w: 1.4, h: 0.05, fill: { color: accent } });
    ps.addTable(
      [
        ["媒体", "費用", "クリック", "CTR", "CV", "CPA", "ROAS"].map((h) => ({
          text: h, options: { bold: true, color: "FFFFFF", fill: { color: accent } },
        })),
        ...d.byPlatform.map((r) => {
          const x = derived(r);
          return cells([r.label, yen(r.costYen), r.clicks.toLocaleString(), `${(x.ctr * 100).toFixed(2)}%`, r.conversions.toFixed(1), x.cpa ? yen(x.cpa) : "—", `${Math.round(x.roas * 100)}%`]);
        }),
      ],
      { x: 0.5, y: 1.3, w: 9, fontSize: 11, border: { type: "solid", color: "E4EBF2", pt: 1 }, autoPage: false }
    );
  }

  // キャンペーン別
  if (d.byCampaign.length > 0) {
    const cs = p.addSlide();
    cs.addText("キャンペーン別（費用上位）", { x: 0.5, y: 0.35, fontSize: 22, bold: true, color: "1C2733" });
    cs.addShape("rect", { x: 0.5, y: 0.95, w: 1.4, h: 0.05, fill: { color: accent } });
    cs.addTable(
      [
        ["キャンペーン", "状態", "費用", "CV", "CPA", "ROAS"].map((h) => ({
          text: h, options: { bold: true, color: "FFFFFF", fill: { color: accent } },
        })),
        ...d.byCampaign.slice(0, 10).map((r) => {
          const x = derived({ ...r, impressions: 0 });
          return cells([r.name.slice(0, 34), r.status === "active" ? "配信中" : "停止", yen(r.costYen), r.conversions.toFixed(1), x.cpa ? yen(x.cpa) : "—", `${Math.round(x.roas * 100)}%`]);
        }),
      ],
      { x: 0.5, y: 1.3, w: 9, fontSize: 10, border: { type: "solid", color: "E4EBF2", pt: 1 }, autoPage: false }
    );
  }

  // 分析と提案
  if (d.insightBody) {
    const is = p.addSlide();
    is.addText("分析と改善提案", { x: 0.5, y: 0.35, fontSize: 22, bold: true, color: "1C2733" });
    is.addShape("rect", { x: 0.5, y: 0.95, w: 1.4, h: 0.05, fill: { color: accent } });
    const lines = d.insightBody
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 22)
      .map((l) => l.replace(/^#+\s*/, "").replace(/\*\*/g, ""));
    is.addText(lines.map((text) => ({ text, options: { breakLine: true } })), {
      x: 0.5, y: 1.3, w: 9, h: 3.9, fontSize: 11, color: "334455", lineSpacingMultiple: 1.15,
    });
  }

  // 実施施策
  if (d.actions.length > 0) {
    const as = p.addSlide();
    as.addText("期間中に実施した施策", { x: 0.5, y: 0.35, fontSize: 22, bold: true, color: "1C2733" });
    as.addShape("rect", { x: 0.5, y: 0.95, w: 1.4, h: 0.05, fill: { color: accent } });
    as.addTable(
      [
        ["日付", "内容", "実行"].map((h) => ({ text: h, options: { bold: true, color: "FFFFFF", fill: { color: accent } } })),
        ...d.actions.slice(0, 12).map((a) => cells([a.at, a.detail.slice(0, 60), a.actor])),
      ],
      { x: 0.5, y: 1.3, w: 9, fontSize: 10, border: { type: "solid", color: "E4EBF2", pt: 1 }, autoPage: false }
    );
  }

  return (await p.write({ outputType: "nodebuffer" })) as Buffer;
}
