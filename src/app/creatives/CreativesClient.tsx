"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, RefreshCw, Sparkles, Type, X as XIcon } from "lucide-react";
import clsx from "clsx";
import type { CreativeFinding, ScoreBasis } from "@/lib/creatives";

export interface AssetRow {
  id: string;
  fieldType: string;
  text: string;
  performanceLabel: string | null;
  pinned: boolean;
  impressions: number;
  clicks: number;
  conversions: number;
  score: number | null;
  grade: "A" | "B" | "C" | "D" | null;
  basis: ScoreBasis;
  ctrIndex: number | null;
  notes: string[];
  aiVerdict: string | null;
  aiSuggestion: string | null;
  aiReason: string | null;
  campaignName?: string;
}

export interface AdBlock {
  adExternalId: string;
  campaignName: string;
  adGroupName: string;
  adStrength: string | null;
  headlineCount: number;
  descriptionCount: number;
  pinnedCount: number;
  extensions: string[];
  headlines: AssetRow[];
  descriptions: AssetRow[];
}

const num = (v: number) => Math.round(v).toLocaleString();
const IMPROVE_THRESHOLD = 60;

const STRENGTH: Record<string, { text: string; cls: string }> = {
  EXCELLENT: { text: "非常に良い", cls: "text-emerald-700" },
  GOOD: { text: "良い", cls: "text-sky-700" },
  AVERAGE: { text: "平均的", cls: "text-amber-700" },
  POOR: { text: "低い", cls: "text-red-700" },
  PENDING: { text: "評価中", cls: "text-gray-500" },
};

const EXT_LABEL: Record<string, string> = {
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

function ScoreBadge({ a }: { a: AssetRow }) {
  if (a.score === null) {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 whitespace-nowrap">データ不足</span>;
  }
  const cls =
    a.grade === "A" ? "bg-emerald-50 text-emerald-700 border-emerald-300"
    : a.grade === "B" ? "bg-sky-50 text-sky-700 border-sky-300"
    : a.grade === "C" ? "bg-amber-50 text-amber-700 border-amber-300"
    : "bg-red-50 text-red-700 border-red-300";
  return (
    <span className={clsx("text-[11px] font-bold px-1.5 py-0.5 rounded border tabular-nums whitespace-nowrap", cls)}>
      {a.score}点 {a.grade}
      {a.basis === "provisional" && <span className="font-normal">（暫定）</span>}
    </span>
  );
}

// 改善フォーム: AIの案を確認・編集してから広告に反映する
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
      <div className="flex flex-wrap items-center gap-2 mt-1">
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
        <button onClick={onCancel} className="ml-auto text-[10px] text-gray-600 hover:text-gray-900">やめる</button>
        <button
          onClick={() => onApply(text.trim(), mode)}
          disabled={busy || over || !text.trim()}
          className="text-[10px] bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-gray-50 rounded px-2 py-0.5"
        >
          {busy ? "反映中…" : "広告に反映"}
        </button>
      </div>
    </div>
  );
}

export function CreativesClient({
  connections, blocks, extensions, findings,
}: {
  connections: { id: string; accountName: string }[];
  blocks: AdBlock[];
  extensions: AssetRow[];
  findings: CreativeFinding[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [connId, setConnId] = useState(connections[0]?.id ?? "");
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(blocks[0]?.adExternalId ?? null);

  const post = async (key: string, url: string, body?: unknown) => {
    setBusy(key);
    setBanner(null);
    const res = await fetch(url, {
      method: "POST",
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string; errors?: string[] };
    setBusy(null);
    if (!res.ok) {
      setBanner({ kind: "error", text: json.error ?? "処理に失敗しました" });
      return null;
    }
    return json;
  };

  const sync = async () => {
    const j = await post("sync", `/api/connections/${connId}/creatives`);
    if (!j) return;
    const errs = (j.errors as string[]) ?? [];
    setBanner({
      kind: errs.length > 0 ? "error" : "ok",
      text: `アセット${j.assets ?? 0}件・広告${j.creatives ?? 0}本を取得しました${errs.length ? `（一部失敗: ${errs.join(" / ")}）` : ""}`,
    });
    router.refresh();
  };

  const suggest = async (a: AssetRow) => {
    const j = await post(`sug-${a.id}`, `/api/connections/${connId}/creatives/suggest`, { assetId: a.id });
    if (!j) return;
    setEditing(a.id);
    router.refresh();
  };

  const apply = async (a: AssetRow, newText: string, mode: "replace" | "add") => {
    const label = a.fieldType === "HEADLINE" ? "見出し" : "説明文";
    const msg =
      mode === "replace"
        ? `${label}を書き換えます。\n\n変更前:「${a.text}」\n変更後:「${newText}」\n\n配信中の広告に即時反映されます。よろしいですか？`
        : `${label}に「${newText}」を追加します。\n配信中の広告に即時反映されます。よろしいですか？`;
    if (!confirm(msg)) return;
    const j = await post(`apply-${a.id}`, `/api/connections/${connId}/creatives/apply`, {
      assetId: a.id, newText, mode,
    });
    if (!j) return;
    setEditing(null);
    setBanner({ kind: "ok", text: `${label}を${mode === "replace" ? "差し替え" : "追加"}ました。変更ログに記録し、14日後に効果を自動検証します。` });
    router.refresh();
  };

  const AssetList = ({ items, kind }: { items: AssetRow[]; kind: "見出し" | "説明文" }) => (
    <div>
      <h4 className="text-[11px] font-semibold text-gray-500 mb-1.5">
        {kind}（{items.length}本）
      </h4>
      <div className="space-y-1">
        {items.map((a) => {
          const needsWork = a.score !== null && a.score < IMPROVE_THRESHOLD;
          return (
            <div key={a.id} className={clsx("rounded-lg border p-2", needsWork ? "border-red-200 bg-red-50/40" : "border-gray-200 bg-white")}>
              <div className="flex items-start gap-2">
                <ScoreBadge a={a} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-800 break-words">
                    {a.text}
                    {a.pinned && <span className="ml-1.5 text-[10px] text-amber-700">ピン留め</span>}
                  </p>
                  <p className="text-[10px] text-gray-500">
                    {a.impressions > 0
                      ? `表示${num(a.impressions)} / クリック${num(a.clicks)}${a.ctrIndex !== null ? ` / 広告内CTR指数 ${a.ctrIndex}` : ""}${a.conversions > 0 ? ` / CV${a.conversions.toFixed(1)}` : ""}`
                      : a.notes[0]}
                  </p>
                  {a.impressions > 0 && a.notes.length > 0 && (
                    <p className="text-[10px] text-gray-400">{a.notes.join(" ・ ")}</p>
                  )}
                </div>
                <div className="shrink-0">
                  {a.aiVerdict === "applied" ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-300">反映済み</span>
                  ) : editing === a.id ? null : a.aiSuggestion ? (
                    <button
                      onClick={() => setEditing(a.id)}
                      disabled={busy !== null}
                      className="text-[10px] bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-gray-50 rounded px-2 py-1"
                    >
                      改善案を見る
                    </button>
                  ) : (
                    <button
                      onClick={() => suggest(a)}
                      disabled={busy !== null}
                      className={clsx(
                        "text-[10px] rounded px-2 py-1 disabled:opacity-50",
                        needsWork
                          ? "bg-red-600 hover:bg-red-500 text-gray-50"
                          : "border border-gray-300 text-gray-600 hover:bg-gray-100"
                      )}
                    >
                      {busy === `sug-${a.id}` ? "生成中…" : "改善"}
                    </button>
                  )}
                </div>
              </div>
              {editing === a.id && (
                <>
                  {a.aiReason && <p className="text-[10px] text-gray-500 mt-1">AIの理由: {a.aiReason}</p>}
                  <ApplyForm
                    asset={a}
                    busy={busy === `apply-${a.id}`}
                    onCancel={() => setEditing(null)}
                    onApply={(t, m) => apply(a, t, m)}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-wrap items-center gap-3 mb-1">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Type size={18} className="text-sky-700" />
            広告クリエイティブ分析
          </h1>
          {connections.length > 1 && (
            <select value={connId} onChange={(e) => setConnId(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white">
              {connections.map((c) => <option key={c.id} value={c.id}>{c.accountName}</option>)}
            </select>
          )}
          <button
            onClick={sync}
            disabled={busy !== null || !connId}
            className="flex items-center gap-1.5 text-sm border border-gray-300 bg-white rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            <RefreshCw size={14} className={busy === "sync" ? "animate-spin" : ""} />
            アセットを取得
          </button>
          <a href="/" className="ml-auto text-sm text-gray-600 hover:text-gray-900">← ダッシュボード</a>
        </div>
        <p className="text-xs text-gray-500 mb-6">
          有効な広告ごとに、実際の反応でスコアを付けます。<strong>同じ広告の中でCTRが平均より働いているか</strong>が基準です（RSAは組み合わせ配信のため、絶対値でなく相対で比べます）。{IMPROVE_THRESHOLD}点未満は改善対象です。
        </p>

        {banner && (
          <div className={clsx("flex items-center gap-2 rounded-lg px-4 py-2.5 mb-4 text-sm",
            banner.kind === "ok" ? "bg-emerald-50 border border-emerald-300 text-emerald-700" : "bg-red-50 border border-red-300 text-red-700")}>
            {banner.kind === "error" && <AlertTriangle size={15} className="shrink-0" />}
            <span className="flex-1">{banner.text}</span>
            <button onClick={() => setBanner(null)}><XIcon size={14} /></button>
          </div>
        )}

        {blocks.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-8 text-center">
            <p className="text-sm text-gray-600 mb-2">まだ広告アセットを取得していません。</p>
            <p className="text-xs text-gray-500">「アセットを取得」で、有効な検索広告の見出し・説明文と実績を読み込みます。</p>
          </div>
        ) : (
          <>
            {findings.length > 0 && (
              <section className="space-y-2 mb-6">
                {findings.map((f, i) => (
                  <div key={i} className={clsx("bg-white border border-gray-200 border-l-4 rounded-lg p-4", LEVEL_STYLE[f.level].border)}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={clsx("text-[10px] px-2 py-0.5 rounded-full shrink-0", LEVEL_STYLE[f.level].chip)}>{LEVEL_STYLE[f.level].label}</span>
                      <h2 className="text-sm font-semibold">{f.title}</h2>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed"><span className="text-gray-400">データ: </span>{f.evidence}</p>
                    <p className="text-xs text-sky-700 leading-relaxed mt-1"><span className="text-sky-500">提案: </span>{f.action}</p>
                  </div>
                ))}
              </section>
            )}

            <div className="space-y-3">
              {blocks.map((b) => {
                const imp = b.headlines.reduce((n, x) => n + x.impressions, 0);
                const weak = [...b.headlines, ...b.descriptions].filter((a) => a.score !== null && a.score < IMPROVE_THRESHOLD).length;
                const isOpen = open === b.adExternalId;
                return (
                  <section key={b.adExternalId} className="bg-white border border-gray-200 rounded-xl shadow-sm">
                    <button
                      onClick={() => setOpen(isOpen ? null : b.adExternalId)}
                      className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 p-4 text-left hover:bg-gray-50 rounded-xl"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold text-gray-900">{b.adGroupName}</span>
                        <span className="block text-[11px] text-gray-500">{b.campaignName}</span>
                      </div>
                      <span className={clsx("text-xs", STRENGTH[b.adStrength ?? ""]?.cls ?? "text-gray-500")}>
                        有効性: {STRENGTH[b.adStrength ?? ""]?.text ?? "—"}
                      </span>
                      <span className={clsx("text-xs tabular-nums", b.headlineCount < 12 ? "text-amber-700" : "text-gray-600")}>
                        見出し{b.headlineCount}/15
                      </span>
                      <span className={clsx("text-xs tabular-nums", b.descriptionCount <= 2 ? "text-amber-700" : "text-gray-600")}>
                        説明文{b.descriptionCount}/4
                      </span>
                      {imp > 0 && <span className="text-xs text-gray-600 tabular-nums">表示{num(imp)}</span>}
                      {weak > 0 && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-300">
                          改善対象 {weak}件
                        </span>
                      )}
                      <span className="ml-auto text-xs text-gray-400">{isOpen ? "閉じる" : "開く"}</span>
                    </button>

                    {isOpen && (
                      <div className="px-4 pb-4 space-y-4">
                        <AssetList items={b.headlines} kind="見出し" />
                        <AssetList items={b.descriptions} kind="説明文" />
                        <p className="text-[10px] text-gray-500">
                          拡張アセット:{" "}
                          {["SITELINK", "CALLOUT", "STRUCTURED_SNIPPET"].map((t) => (
                            <span key={t} className={clsx("mr-2", b.extensions.includes(t) ? "text-emerald-700" : "text-gray-400 line-through")}>
                              {EXT_LABEL[t]}
                            </span>
                          ))}
                        </p>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>

            {extensions.length > 0 && (
              <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 sm:p-5 mt-6">
                <h2 className="font-semibold mb-2">拡張アセット（{extensions.length}件）</h2>
                <p className="text-[11px] text-gray-500 mb-2">サイトリンク・コールアウト・構造化スニペットは広告の占有面積を増やしCTRを押し上げます。</p>
                <div className="flex flex-wrap gap-1.5">
                  {extensions.map((e) => (
                    <span key={e.id} className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-700">
                      <span className="text-[10px] text-gray-400 mr-1">{EXT_LABEL[e.fieldType] ?? e.fieldType}</span>
                      {e.text}
                    </span>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
