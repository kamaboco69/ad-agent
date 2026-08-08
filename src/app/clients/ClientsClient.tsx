"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Download, LayoutGrid, Loader2, RefreshCw, Settings2, X as XIcon } from "lucide-react";
import clsx from "clsx";

export interface ClientRow {
  id: string;
  accountName: string;
  platform: string;
  platformLabel: string;
  platformColor: string;
  mode: string;
  status: string;
  lastError: string | null;
  lastSyncedAt: string | null;
  pacing: {
    status: string;
    statusLabel: string;
    monthlyBudgetYen: number | null;
    mtdYen: number;
    forecastYen: number;
    forecastRate: number | null;
    recommendedDailyYen: number | null;
    recentAvgDaily: number;
    daysRemaining: number;
  };
  cost30: number;
  cv30: number;
  cpa30: number | null;
  roas30: number;
  targetCpaYen: number | null;
  targetRoas: number | null;
  hasTemplate: boolean;
  autoSend: boolean;
}

const yen = (v: number) => `¥${Math.round(v).toLocaleString()}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

const PACE_STYLE: Record<string, string> = {
  over: "bg-red-50 text-red-700 border-red-300",
  under: "bg-amber-50 text-amber-700 border-amber-300",
  ontrack: "bg-emerald-50 text-emerald-700 border-emerald-300",
  nobudget: "bg-gray-100 text-gray-500 border-gray-200",
};

export function ClientsClient({
  rows,
  alerts,
}: {
  rows: ClientRow[];
  alerts: { id: string; title: string; at: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [sort, setSort] = useState<"risk" | "cost" | "name">("risk");

  const syncAll = async () => {
    setBusy("sync");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as { ok?: number; failed?: number; error?: string };
      setBanner(
        res.ok
          ? { kind: "ok", text: `全クライアントを同期しました（成功${j.ok ?? 0}件${j.failed ? `・失敗${j.failed}件` : ""}）` }
          : { kind: "error", text: j.error ?? "同期に失敗しました" }
      );
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const download = (id: string, format: "xlsx" | "pptx") => {
    setBusy(`dl-${id}-${format}`);
    // 生成に数秒かかるため、ブラウザのダウンロードに任せてすぐ解除する
    window.location.href = `/api/connections/${id}/export?format=${format}`;
    setTimeout(() => setBusy(null), 3000);
  };

  // リスク順: 超過見込み → 未達見込み → エラー → その他
  const sorted = [...rows].sort((a, b) => {
    if (sort === "cost") return b.cost30 - a.cost30;
    if (sort === "name") return a.accountName.localeCompare(b.accountName, "ja");
    const rank = (r: ClientRow) =>
      r.status === "error" ? 0 : r.pacing.status === "over" ? 1 : r.pacing.status === "under" ? 2 : 3;
    return rank(a) - rank(b) || b.cost30 - a.cost30;
  });

  const totals = rows.reduce(
    (acc, r) => ({
      mtd: acc.mtd + r.pacing.mtdYen,
      budget: acc.budget + (r.pacing.monthlyBudgetYen ?? 0),
      forecast: acc.forecast + r.pacing.forecastYen,
      cv: acc.cv + r.cv30,
    }),
    { mtd: 0, budget: 0, forecast: 0, cv: 0 }
  );
  const over = rows.filter((r) => r.pacing.status === "over").length;
  const under = rows.filter((r) => r.pacing.status === "under").length;
  const errored = rows.filter((r) => r.status === "error").length;

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-wrap items-center gap-3 mb-1">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <LayoutGrid size={18} className="text-sky-700" />
            クライアント進捗管理
          </h1>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs bg-white">
            {([["risk", "リスク順"], ["cost", "消化額順"], ["name", "名前順"]] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setSort(id)}
                className={clsx("px-3 py-1.5", sort === id ? "bg-sky-700 text-gray-50" : "text-gray-600 hover:bg-gray-100")}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={syncAll}
            disabled={busy !== null}
            className="flex items-center gap-1.5 text-sm bg-sky-700 hover:bg-sky-600 disabled:opacity-60 text-gray-50 px-3 py-1.5 rounded-lg"
          >
            <RefreshCw size={14} className={busy === "sync" ? "animate-spin" : ""} />
            全同期
          </button>
          <a href="/" className="ml-auto text-sm text-gray-600 hover:text-gray-900">← ダッシュボード</a>
        </div>
        <p className="text-xs text-gray-500 mb-6">
          月予算に対する<strong>着地予想</strong>と<strong>日予算目安</strong>を、直近7日の実消化ペースから算出しています（単純な日割りではありません）。
        </p>

        {banner && (
          <div className={clsx("flex items-center gap-2 rounded-lg px-4 py-2.5 mb-4 text-sm",
            banner.kind === "ok" ? "bg-emerald-50 border border-emerald-300 text-emerald-700" : "bg-red-50 border border-red-300 text-red-700")}>
            {banner.kind === "error" && <AlertTriangle size={15} className="shrink-0" />}
            <span className="flex-1">{banner.text}</span>
            <button onClick={() => setBanner(null)}><XIcon size={14} /></button>
          </div>
        )}

        {/* 全社サマリー */}
        <section className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          {[
            { label: "クライアント数", value: `${rows.length}件`, sub: errored > 0 ? `エラー ${errored}件` : "全て正常" },
            { label: "今月の消化", value: yen(totals.mtd), sub: totals.budget > 0 ? `月予算計 ${yen(totals.budget)}` : "予算未設定" },
            {
              label: "着地予想（合計）",
              value: yen(totals.forecast),
              sub: totals.budget > 0 ? `予算比 ${pct(totals.forecast / totals.budget)}` : "—",
            },
            { label: "超過見込み", value: `${over}件`, cls: over > 0 ? "text-red-700" : undefined },
            { label: "未達見込み", value: `${under}件`, cls: under > 0 ? "text-amber-700" : undefined },
          ].map((t) => (
            <div key={t.label} className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
              <div className="text-[11px] text-gray-500">{t.label}</div>
              <div className={clsx("text-xl font-bold tabular-nums mt-0.5", t.cls)}>{t.value}</div>
              {t.sub && <div className="text-[11px] text-gray-500 mt-0.5">{t.sub}</div>}
            </div>
          ))}
        </section>

        {alerts.length > 0 && (
          <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 mb-6">
            <h2 className="text-sm font-semibold mb-2">未対応のアラート（{alerts.length}件）</h2>
            <div className="flex flex-wrap gap-1.5">
              {alerts.slice(0, 12).map((a) => (
                <span key={a.id} className="text-[11px] border border-amber-300 bg-amber-50 text-amber-800 rounded px-2 py-1">
                  <span className="text-gray-500 mr-1">{a.at}</span>{a.title}
                </span>
              ))}
            </div>
          </section>
        )}

        {rows.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-8 text-center text-sm text-gray-600">
            接続されたクライアントがありません。ダッシュボードの「媒体接続」から追加してください。
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="text-[11px] text-gray-500 border-b border-gray-200">
                  <th className="text-left font-normal py-2.5 px-4">クライアント</th>
                  <th className="text-left font-normal py-2.5 px-3">進捗</th>
                  <th className="text-right font-normal py-2.5 px-3">今月の消化 / 月予算</th>
                  <th className="text-right font-normal py-2.5 px-3">着地予想</th>
                  <th className="text-right font-normal py-2.5 px-3">日予算目安</th>
                  <th className="text-right font-normal py-2.5 px-3">CPA（30日）</th>
                  <th className="text-right font-normal py-2.5 px-3">ROAS</th>
                  <th className="text-left font-normal py-2.5 px-3">最終同期</th>
                  <th className="text-right font-normal py-2.5 px-4">レポート</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const p = r.pacing;
                  const cpaOver = r.targetCpaYen && r.cpa30 && r.cpa30 > r.targetCpaYen;
                  return (
                    <tr key={r.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.platformColor }} />
                          <span className="font-medium text-gray-900">{r.accountName}</span>
                          <span className="text-[10px] text-gray-500">{r.platformLabel}</span>
                          {r.mode === "demo" && <span className="text-[10px] text-gray-400">デモ</span>}
                        </div>
                        {r.status === "error" && r.lastError && (
                          <p className="text-[10px] text-red-600 mt-0.5 max-w-[260px] truncate">{r.lastError}</p>
                        )}
                      </td>
                      <td className="px-3">
                        <span className={clsx("text-[11px] px-2 py-0.5 rounded-full border", PACE_STYLE[p.status])}>
                          {p.statusLabel}
                        </span>
                      </td>
                      <td className="text-right px-3 tabular-nums">
                        <span className="text-gray-900">{yen(p.mtdYen)}</span>
                        <span className="text-gray-400"> / {p.monthlyBudgetYen ? yen(p.monthlyBudgetYen) : "—"}</span>
                      </td>
                      <td className={clsx("text-right px-3 tabular-nums font-medium",
                        p.status === "over" ? "text-red-700" : p.status === "under" ? "text-amber-700" : "text-gray-900")}>
                        {yen(p.forecastYen)}
                        {p.forecastRate !== null && (
                          <span className="block text-[10px] font-normal text-gray-500">予算比 {pct(p.forecastRate)}</span>
                        )}
                      </td>
                      <td className="text-right px-3 tabular-nums text-gray-700">
                        {p.recommendedDailyYen !== null ? (
                          <>
                            {yen(p.recommendedDailyYen)}
                            <span className="block text-[10px] text-gray-500">直近実績 {yen(p.recentAvgDaily)}/日</span>
                          </>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className={clsx("text-right px-3 tabular-nums", cpaOver ? "text-red-700" : "text-gray-800")}>
                        {r.cpa30 ? yen(r.cpa30) : "—"}
                        {r.targetCpaYen && (
                          <span className="block text-[10px] text-gray-500">目標 {yen(r.targetCpaYen)}</span>
                        )}
                      </td>
                      <td className="text-right px-3 tabular-nums text-gray-800">{Math.round(r.roas30)}%</td>
                      <td className="px-3 text-[11px] text-gray-500">{r.lastSyncedAt ?? "未同期"}</td>
                      <td className="text-right px-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => download(r.id, "xlsx")}
                            disabled={busy !== null}
                            title="Excelでダウンロード"
                            className="flex items-center gap-1 text-[10px] border border-gray-300 rounded px-1.5 py-1 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                          >
                            {busy === `dl-${r.id}-xlsx` ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                            Excel
                          </button>
                          <button
                            onClick={() => download(r.id, "pptx")}
                            disabled={busy !== null}
                            title="PowerPointでダウンロード"
                            className="flex items-center gap-1 text-[10px] border border-gray-300 rounded px-1.5 py-1 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                          >
                            {busy === `dl-${r.id}-pptx` ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                            PPT
                          </button>
                          <a
                            href={`/clients/${r.id}/template`}
                            title="レポートの体裁・自動配信を設定"
                            className={clsx("flex items-center gap-1 text-[10px] rounded px-1.5 py-1 border",
                              r.autoSend ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-gray-300 text-gray-700 hover:bg-gray-100")}
                          >
                            <Settings2 size={11} />
                            {r.autoSend ? "自動配信中" : "設定"}
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
