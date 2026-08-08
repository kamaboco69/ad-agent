"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, RefreshCw, Sparkles, Type, X as XIcon } from "lucide-react";
import clsx from "clsx";
import type { CreativeFinding } from "@/lib/creatives";

export interface AssetRow {
  id: string;
  fieldType: string;
  text: string;
  performanceLabel: string | null;
  pinned: boolean;
  impressions: number;
  clicks: number;
  conversions: number;
  campaignName: string;
  adGroupName: string | null;
  lowDays: number | null;
  aiVerdict: string | null;
  aiSuggestion: string | null;
  aiReason: string | null;
}

export interface CreativeRow {
  id: string;
  campaignName: string;
  adGroupName: string;
  adStrength: string | null;
  headlineCount: number;
  descriptionCount: number;
  pinnedCount: number;
  extensions: string[];
}

const num = (v: number) => Math.round(v).toLocaleString();
const pctOf = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(2)}%` : "—");

// 評価ラベル（Google広告の「最良/良/低」に対応）
const LABELS: Record<string, { text: string; cls: string }> = {
  BEST: { text: "最良", cls: "bg-emerald-50 text-emerald-700 border border-emerald-300" },
  GOOD: { text: "良", cls: "bg-sky-50 text-sky-700 border border-sky-300" },
  LOW: { text: "低", cls: "bg-red-50 text-red-700 border border-red-300" },
  LEARNING: { text: "学習中", cls: "bg-amber-50 text-amber-700 border border-amber-300" },
  PENDING: { text: "保留", cls: "bg-gray-100 text-gray-600" },
  NOT_APPLICABLE: { text: "評価対象外", cls: "bg-gray-100 text-gray-500" },
  UNKNOWN: { text: "不明", cls: "bg-gray-100 text-gray-500" },
};

const STRENGTH: Record<string, { text: string; cls: string }> = {
  EXCELLENT: { text: "非常に良い", cls: "text-emerald-700" },
  GOOD: { text: "良い", cls: "text-sky-700" },
  AVERAGE: { text: "平均的", cls: "text-amber-700" },
  POOR: { text: "低い", cls: "text-red-700" },
  PENDING: { text: "評価中", cls: "text-gray-500" },
};

const FIELD_LABEL: Record<string, string> = {
  HEADLINE: "見出し",
  DESCRIPTION: "説明文",
  SITELINK: "サイトリンク",
  CALLOUT: "コールアウト",
  STRUCTURED_SNIPPET: "構造化スニペット",
};

const LEVEL_STYLE: Record<CreativeFinding["level"], { chip: string; label: string; border: string }> = {
  crit: { chip: "bg-red-50 text-red-700 border border-red-300", label: "要対応", border: "border-l-red-500" },
  warn: { chip: "bg-amber-50 text-amber-700 border border-amber-300", label: "注意", border: "border-l-amber-500" },
  good: { chip: "bg-emerald-50 text-emerald-700 border border-emerald-300", label: "好機", border: "border-l-emerald-500" },
  info: { chip: "bg-gray-200 text-gray-600", label: "情報", border: "border-l-neutral-400" },
};

// Google広告の文字数カウント（全角は2文字分）
const adLen = (s: string) => [...s].reduce((n, ch) => n + (/[ -~｡-ﾟ]/.test(ch) ? 1 : 2), 0);
const LIMIT: Record<string, number> = { HEADLINE: 30, DESCRIPTION: 90 };

// 適用フォーム: 文言を確認・編集してから広告に反映する（本番配信に直接影響するため）
function ApplyForm({
  asset, busy, onCancel, onApply,
}: {
  asset: AssetRow;
  busy: boolean;
  onCancel: () => void;
  onApply: (text: string, mode: "replace" | "add") => void;
}) {
  const [text, setText] = useState(asset.aiSuggestion ?? "");
  const [mode, setMode] = useState<"replace" | "add">("replace");
  const limit = LIMIT[asset.fieldType] ?? 30;
  const len = adLen(text);
  const over = len > limit;

  return (
    <div className="mt-1.5 border border-sky-300 bg-sky-50 rounded-lg p-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={asset.fieldType === "HEADLINE" ? 2 : 3}
        className="w-full text-xs border border-gray-300 rounded px-1.5 py-1 bg-white"
      />
      <div className="flex items-center gap-2 mt-1">
        <span className={clsx("text-[10px] tabular-nums", over ? "text-red-600 font-semibold" : "text-gray-500")}>
          {len}/{limit}
        </span>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as "replace" | "add")}
          className="text-[10px] border border-gray-300 rounded px-1 py-0.5 bg-white"
        >
          <option value="replace">この文言と差し替える</option>
          <option value="add">残したまま追加する</option>
        </select>
        <button onClick={onCancel} className="ml-auto text-[10px] text-gray-600 hover:text-gray-900">
          やめる
        </button>
        <button
          onClick={() => onApply(text.trim(), mode)}
          disabled={busy || over || !text.trim()}
          className="text-[10px] bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white rounded px-2 py-0.5"
        >
          {busy ? "反映中…" : "広告に反映"}
        </button>
      </div>
      <p className="text-[10px] text-gray-500 mt-1">
        {mode === "replace"
          ? "既存の文言を書き換えます。ピン留めは維持されます。"
          : "既存を残して新しく追加します（上限まで）。手順書の推奨はこちらです。"}
      </p>
    </div>
  );
}

export function CreativesClient({
  connections, assets, creatives, findings,
}: {
  connections: { id: string; accountName: string }[];
  assets: AssetRow[];
  creatives: CreativeRow[];
  findings: CreativeFinding[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [connId, setConnId] = useState(connections[0]?.id ?? "");
  const [tab, setTab] = useState<"HEADLINE" | "DESCRIPTION" | "EXT">("HEADLINE");
  const [editing, setEditing] = useState<string | null>(null);

  // AIの案を実際の広告に反映する
  const apply = async (asset: AssetRow, newText: string, mode: "replace" | "add") => {
    const label = asset.fieldType === "HEADLINE" ? "見出し" : "説明文";
    const msg =
      mode === "replace"
        ? `${label}を書き換えます。\n\n変更前:「${asset.text}」\n変更後:「${newText}」\n\n配信中の広告に即時反映されます。よろしいですか？`
        : `${label}に「${newText}」を追加します。\n配信中の広告に即時反映されます。よろしいですか？`;
    if (!confirm(msg)) return;

    setBusy(`apply-${asset.id}`);
    setBanner(null);
    try {
      const res = await fetch(`/api/connections/${connId}/creatives/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: asset.id, newText, mode }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setBanner({ kind: "error", text: json.error ?? "反映に失敗しました" });
        return;
      }
      setEditing(null);
      setBanner({
        kind: "ok",
        text: `${label}を${mode === "replace" ? "差し替え" : "追加"}ました。変更ログに記録し、14日後に効果を自動検証します。`,
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const call = async (key: string, url: string, okMsg: (j: Record<string, number>) => string) => {
    setBusy(key);
    setBanner(null);
    try {
      const res = await fetch(url, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as Record<string, number> & {
        error?: string;
        errors?: string[];
      };
      if (!res.ok) {
        setBanner({ kind: "error", text: json.error ?? "処理に失敗しました" });
        return;
      }
      // 一部のクエリだけ失敗した場合は、0件の理由が分かるよう明示する
      const partial = json.errors ?? [];
      setBanner(
        partial.length > 0
          ? { kind: "error", text: `${okMsg(json)}（一部取得できませんでした: ${partial.join(" / ")}）` }
          : { kind: "ok", text: okMsg(json) }
      );
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const shown = assets.filter((a) =>
    tab === "EXT" ? !["HEADLINE", "DESCRIPTION"].includes(a.fieldType) : a.fieldType === tab
  );

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-wrap items-center gap-3 mb-1">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Type size={18} className="text-sky-700" />
            広告クリエイティブ分析
          </h1>
          {connections.length > 1 && (
            <select
              value={connId}
              onChange={(e) => setConnId(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white"
            >
              {connections.map((c) => <option key={c.id} value={c.id}>{c.accountName}</option>)}
            </select>
          )}
          <button
            onClick={() => call("sync", `/api/connections/${connId}/creatives`, (j) => `アセット${j.assets ?? 0}件・広告${j.creatives ?? 0}本を取得しました`)}
            disabled={busy !== null || !connId}
            className="flex items-center gap-1.5 text-sm border border-gray-300 bg-white rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            <RefreshCw size={14} className={busy === "sync" ? "animate-spin" : ""} />
            アセットを取得
          </button>
          <button
            onClick={() => call("ai", `/api/connections/${connId}/creatives?analyze=1`, (j) => `${j.analyzed ?? 0}件を分析しました`)}
            disabled={busy !== null || !connId || assets.length === 0}
            className="flex items-center gap-1.5 text-sm bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white rounded-lg px-3 py-1.5"
          >
            {busy === "ai" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            AIで改善案を出す
          </button>
          <a href="/" className="ml-auto text-sm text-gray-600 hover:text-gray-900">← ダッシュボード</a>
        </div>
        <p className="text-xs text-gray-500 mb-6">
          Google広告の評価（最良／良／低）と実績から、伸ばす訴求と差し替える訴求を判断します。低評価が2週間続いたら差し替え候補です。
        </p>

        {banner && (
          <div className={clsx("flex items-center gap-2 rounded-lg px-4 py-2.5 mb-4 text-sm",
            banner.kind === "ok" ? "bg-emerald-50 border border-emerald-300 text-emerald-700" : "bg-red-50 border border-red-300 text-red-700")}>
            {banner.kind === "error" && <AlertTriangle size={15} className="shrink-0" />}
            <span className="flex-1">{banner.text}</span>
            <button onClick={() => setBanner(null)}><XIcon size={14} /></button>
          </div>
        )}

        {assets.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-8 text-center">
            <p className="text-sm text-gray-600 mb-2">まだ広告アセットを取得していません。</p>
            <p className="text-xs text-gray-500">
              「アセットを取得」を押すと、Google広告から見出し・説明文の評価と実績を読み込みます（検索キャンペーンが対象です）。
            </p>
          </div>
        ) : (
          <>
            {findings.length > 0 && (
              <section className="space-y-2 mb-6">
                {findings.map((f, i) => (
                  <div key={i} className={clsx("bg-white border border-gray-200 border-l-4 rounded-lg p-4", LEVEL_STYLE[f.level].border)}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={clsx("text-[10px] px-2 py-0.5 rounded-full shrink-0", LEVEL_STYLE[f.level].chip)}>
                        {LEVEL_STYLE[f.level].label}
                      </span>
                      <h2 className="text-sm font-semibold">{f.title}</h2>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed"><span className="text-gray-400">データ: </span>{f.evidence}</p>
                    <p className="text-xs text-sky-700 leading-relaxed mt-1"><span className="text-sky-500">提案: </span>{f.action}</p>
                  </div>
                ))}
              </section>
            )}

            {creatives.length > 0 && (
              <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 sm:p-5 mb-6">
                <h2 className="font-semibold mb-3">広告の有効性</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead>
                      <tr className="text-[11px] text-gray-500 border-b border-gray-200">
                        <th className="text-left font-normal py-2 pr-3">広告グループ</th>
                        <th className="text-left font-normal py-2 px-3">有効性</th>
                        <th className="text-right font-normal py-2 px-3">見出し</th>
                        <th className="text-right font-normal py-2 px-3">説明文</th>
                        <th className="text-right font-normal py-2 px-3">ピン留め</th>
                        <th className="text-left font-normal py-2 pl-3">拡張アセット</th>
                      </tr>
                    </thead>
                    <tbody>
                      {creatives.map((c) => (
                        <tr key={c.id} className="border-b border-gray-100 last:border-0">
                          <td className="py-2.5 pr-3 max-w-[260px] truncate">
                            <span className="text-gray-800">{c.adGroupName}</span>
                            <span className="block text-[10px] text-gray-500">{c.campaignName}</span>
                          </td>
                          <td className={clsx("px-3", STRENGTH[c.adStrength ?? ""]?.cls ?? "text-gray-500")}>
                            {STRENGTH[c.adStrength ?? ""]?.text ?? "—"}
                          </td>
                          <td className={clsx("text-right px-3 tabular-nums", c.headlineCount < 8 ? "text-amber-700" : "text-gray-700")}>
                            {c.headlineCount} / 15
                          </td>
                          <td className={clsx("text-right px-3 tabular-nums", c.descriptionCount < 3 ? "text-amber-700" : "text-gray-700")}>
                            {c.descriptionCount} / 4
                          </td>
                          <td className={clsx("text-right px-3 tabular-nums", c.pinnedCount > 2 ? "text-amber-700" : "text-gray-600")}>
                            {c.pinnedCount}
                          </td>
                          <td className="pl-3 text-xs text-gray-600">
                            {["SITELINK", "CALLOUT", "STRUCTURED_SNIPPET"].map((t) => (
                              <span key={t} className={clsx("mr-2", c.extensions.includes(t) ? "text-emerald-700" : "text-gray-400 line-through")}>
                                {FIELD_LABEL[t]}
                              </span>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="font-semibold">アセット別の成績</h2>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs ml-2">
                  {([["HEADLINE", "見出し"], ["DESCRIPTION", "説明文"], ["EXT", "拡張"]] as const).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setTab(id)}
                      className={clsx("px-3 py-1.5", tab === id ? "bg-sky-700 text-white" : "text-gray-600 hover:bg-gray-100")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-gray-500 ml-auto">{shown.length}件</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] text-gray-500 border-b border-gray-200">
                      <th className="text-left font-normal py-2 pr-3">文言</th>
                      <th className="text-left font-normal py-2 px-3">評価</th>
                      <th className="text-right font-normal py-2 px-3">表示</th>
                      <th className="text-right font-normal py-2 px-3">CTR</th>
                      <th className="text-right font-normal py-2 px-3">CV</th>
                      <th className="text-left font-normal py-2 pl-3">AIの判断と改善案</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((a) => (
                      <tr key={a.id} className="border-b border-gray-100 last:border-0 align-top">
                        <td className="py-2.5 pr-3 max-w-[260px]">
                          <span className="text-gray-800">{a.text}</span>
                          <span className="block text-[10px] text-gray-500">
                            {a.adGroupName ?? a.campaignName}
                            {a.pinned && <span className="ml-1 text-amber-700">ピン留め</span>}
                          </span>
                        </td>
                        <td className="px-3">
                          {a.performanceLabel ? (
                            <span className={clsx("text-[10px] px-1.5 py-0.5 rounded", LABELS[a.performanceLabel]?.cls ?? "bg-gray-100 text-gray-600")}>
                              {LABELS[a.performanceLabel]?.text ?? a.performanceLabel}
                            </span>
                          ) : <span className="text-gray-400 text-xs">—</span>}
                          {a.lowDays !== null && a.lowDays >= 14 && (
                            <span className="block text-[10px] text-red-600 mt-0.5">低評価{a.lowDays}日</span>
                          )}
                        </td>
                        <td className="text-right px-3 tabular-nums text-gray-600">{num(a.impressions)}</td>
                        <td className="text-right px-3 tabular-nums text-gray-600">{pctOf(a.clicks, a.impressions)}</td>
                        <td className="text-right px-3 tabular-nums text-gray-800">{a.conversions.toFixed(1)}</td>
                        <td className="pl-3 max-w-[340px]">
                          {a.aiVerdict === "applied" ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-300">
                              反映済み
                            </span>
                          ) : a.aiVerdict === "replace" ? (
                            <>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-300">差し替え推奨</span>
                              {a.aiReason && <p className="text-[10px] text-gray-500 mt-0.5">{a.aiReason}</p>}
                              {a.aiSuggestion &&
                                (editing === a.id ? (
                                  <ApplyForm
                                    asset={a}
                                    busy={busy === `apply-${a.id}`}
                                    onCancel={() => setEditing(null)}
                                    onApply={(text, mode) => apply(a, text, mode)}
                                  />
                                ) : (
                                  <div className="mt-1">
                                    <p className="text-xs text-gray-800">→「{a.aiSuggestion}」</p>
                                    <button
                                      onClick={() => setEditing(a.id)}
                                      disabled={busy !== null}
                                      className="mt-1 text-[11px] bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white rounded px-2 py-0.5"
                                    >
                                      この案を適用
                                    </button>
                                  </div>
                                ))}
                            </>
                          ) : a.aiVerdict === "keep" ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">継続</span>
                          ) : (
                            <span className="text-[10px] text-gray-400">未分析</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-gray-500 mt-3">
                差し替えるときは、既存の「最良」「良」は残したまま新しい案を追加して比較してください（全入れ替えは学習をやり直しにします）。
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
