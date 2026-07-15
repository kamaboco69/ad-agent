"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  BarChart3,
  Loader2,
  Plug,
  RefreshCw,
  Sparkles,
  Trash2,
  X as XIcon,
  AlertTriangle,
  FileText,
  LogOut,
  Pause,
  Play,
} from "lucide-react";
import clsx from "clsx";

// ── 型（page.tsx から渡されるデータ） ──────────────────

export interface Kpi {
  costYen: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValueYen: number;
}

export interface PlatformRow extends Kpi {
  platform: string;
}

export interface CampaignRow extends Kpi {
  id: string;
  name: string;
  platform: string;
  mode: string;
  status: string;
  objective: string | null;
  dailyBudgetYen: number | null;
}

export interface ConnectionView {
  id: string;
  mode: string;
  status: string;
  accountName: string;
  monthlyBudgetYen: number | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface PlatformView {
  id: string;
  label: string;
  short: string;
  color: string;
  apiName: string;
  note: string | null;
  apiAvailable: boolean;
  connections: ConnectionView[];
}

export interface InsightView {
  id: string;
  kind: string;
  title: string;
  body: string;
  status: string;
  createdAt: string;
}

export interface DashboardData {
  days: number;
  totals: Kpi;
  daily: { date: string; byPlatform: Record<string, number>; total: number }[];
  platformAgg: PlatformRow[];
  campaigns: CampaignRow[];
  platforms: PlatformView[];
  insights: InsightView[];
  aiConfigured: boolean;
}

// ── フォーマッタ ──────────────────────────────────────

const yen = (v: number) => `¥${Math.round(v).toLocaleString()}`;
const yenAxis = (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(v >= 100000 ? 0 : 1)}万` : `${(v / 1000).toFixed(0)}k`);
const num = (v: number) => Math.round(v).toLocaleString();
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

function kpiDerived(k: Kpi) {
  return {
    ctr: k.impressions ? k.clicks / k.impressions : 0,
    cpc: k.clicks ? k.costYen / k.clicks : 0,
    cpa: k.conversions ? k.costYen / k.conversions : null,
    roas: k.costYen ? k.conversionValueYen / k.costYen : 0,
  };
}

// ── 簡易 Markdown 表示（見出し/箇条書き/太字のみ） ──────

function InlineBold({ text }: { text: string }) {
  const parts = text.split("**");
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <strong key={i} className="text-white font-semibold">{p}</strong> : p))}
    </>
  );
}

function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-gray-300">
      {lines.map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="h-1" />;
        if (t.startsWith("### ")) return <h4 key={i} className="text-white font-semibold pt-1"><InlineBold text={t.slice(4)} /></h4>;
        if (t.startsWith("## ")) return <h3 key={i} className="text-white font-bold pt-2"><InlineBold text={t.slice(3)} /></h3>;
        if (t.startsWith("- ")) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-gray-500 shrink-0">・</span>
              <span><InlineBold text={t.slice(2)} /></span>
            </div>
          );
        }
        return <p key={i}><InlineBold text={t} /></p>;
      })}
    </div>
  );
}

// ── トレンドチャート（日別消化額 × 媒体、ホバー付きライン） ──

const CW = 800;
const CH = 250;
const PAD = { l: 44, r: 10, t: 12, b: 22 };

function TrendChart({
  daily,
  platforms,
}: {
  daily: DashboardData["daily"];
  platforms: PlatformView[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const activePlatforms = useMemo(
    () => platforms.filter((p) => daily.some((d) => (d.byPlatform[p.id] ?? 0) > 0)),
    [daily, platforms]
  );

  const maxY = useMemo(() => {
    let m = 0;
    for (const d of daily) for (const p of activePlatforms) m = Math.max(m, d.byPlatform[p.id] ?? 0);
    return m || 1;
  }, [daily, activePlatforms]);

  const n = daily.length;
  const plotW = CW - PAD.l - PAD.r;
  const plotH = CH - PAD.t - PAD.b;
  const xAt = (i: number) => PAD.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => PAD.t + plotH - (v / maxY) * plotH;

  const gridYs = [0.25, 0.5, 0.75, 1].map((f) => ({ v: maxY * f, y: yAt(maxY * f) }));
  const xTickEvery = Math.max(1, Math.ceil(n / 7));

  function onMove(e: React.MouseEvent) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || n === 0) return;
    const fx = ((e.clientX - rect.left) / rect.width) * CW;
    const idx = Math.round(((fx - PAD.l) / plotW) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, idx)));
  }

  if (n === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-gray-500 text-sm">
        表示できる実績データがありません
      </div>
    );
  }

  const h = hover !== null ? daily[hover] : null;

  return (
    <div ref={wrapRef} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full h-auto block" role="img" aria-label="日別消化額の推移">
        {gridYs.map((g, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={CW - PAD.r} y1={g.y} y2={g.y} stroke="#27272a" strokeWidth={1} />
            <text x={PAD.l - 6} y={g.y + 3} textAnchor="end" fontSize={10} fill="#71717a">
              {yenAxis(g.v)}
            </text>
          </g>
        ))}
        <line x1={PAD.l} x2={CW - PAD.r} y1={PAD.t + plotH} y2={PAD.t + plotH} stroke="#3f3f46" strokeWidth={1} />
        {daily.map((d, i) =>
          i % xTickEvery === 0 ? (
            <text key={d.date} x={xAt(i)} y={CH - 6} textAnchor="middle" fontSize={10} fill="#71717a">
              {Number(d.date.slice(5, 7))}/{Number(d.date.slice(8, 10))}
            </text>
          ) : null
        )}
        {hover !== null && (
          <line x1={xAt(hover)} x2={xAt(hover)} y1={PAD.t} y2={PAD.t + plotH} stroke="#52525b" strokeWidth={1} strokeDasharray="3 3" />
        )}
        {activePlatforms.map((p) => {
          const dPath = daily
            .map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(d.byPlatform[p.id] ?? 0).toFixed(1)}`)
            .join(" ");
          return <path key={p.id} d={dPath} fill="none" stroke={p.color} strokeWidth={2} strokeLinejoin="round" />;
        })}
        {hover !== null &&
          activePlatforms.map((p) => (
            <circle
              key={p.id}
              cx={xAt(hover)}
              cy={yAt(daily[hover].byPlatform[p.id] ?? 0)}
              r={4}
              fill={p.color}
              stroke="#0a0a0a"
              strokeWidth={2}
            />
          ))}
      </svg>

      {h && (
        <div
          className="absolute top-2 pointer-events-none bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs shadow-xl z-10"
          style={hover! < n / 2 ? { left: `${(xAt(hover!) / CW) * 100}%`, marginLeft: 12 } : { right: `${100 - (xAt(hover!) / CW) * 100}%`, marginRight: 12 }}
        >
          <div className="text-gray-400 mb-1">{h.date}（計 {yen(h.total)}）</div>
          {activePlatforms
            .map((p) => ({ p, v: h.byPlatform[p.id] ?? 0 }))
            .sort((a, b) => b.v - a.v)
            .map(({ p, v }) => (
              <div key={p.id} className="flex items-center gap-1.5 text-gray-200">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                <span className="text-gray-400">{p.short}</span>
                <span className="ml-auto pl-3 tabular-nums">{yen(v)}</span>
              </div>
            ))}
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 px-1">
        {activePlatforms.map((p) => (
          <span key={p.id} className="inline-flex items-center gap-1.5 text-xs text-gray-400">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── アカウント追加接続（MCC配下からチェックで複数選択） ──

function AccountPickerModal({
  conn,
  onClose,
  onDone,
}: {
  conn: ConnectionView;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  type Acct = { id: string; loginCustomerId: string | null; name: string };
  const [accounts, setAccounts] = useState<Acct[] | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/connections/${conn.id}/accounts`);
      const json = (await res.json().catch(() => ({}))) as { accounts?: Acct[]; error?: string };
      if (res.ok) setAccounts(json.accounts ?? []);
      else setError(json.error ?? "アカウント一覧の取得に失敗しました");
    })();
  }, [conn.id]);

  const submit = async () => {
    const sel = (accounts ?? []).filter((a) => checked[a.id]);
    if (sel.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/connections/${conn.id}/add-accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts: sel }),
      });
      const json = (await res.json().catch(() => ({}))) as { created?: number; skipped?: number; error?: string };
      if (!res.ok) {
        setError(json.error ?? "追加に失敗しました");
        return;
      }
      onDone(
        `${json.created ?? 0}件のアカウントを接続しました${json.skipped ? `（${json.skipped}件は接続済みのためスキップ）` : ""}`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-y-auto p-4 sm:p-8" onClick={onClose}>
      <div
        className="w-full max-w-md bg-neutral-950 border border-neutral-800 rounded-xl p-5 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <Plug size={15} className="text-sky-400" />
          <h3 className="text-white font-semibold text-sm">アカウントを追加接続</h3>
          <button onClick={onClose} className="ml-auto text-gray-500 hover:text-white">
            <XIcon size={16} />
          </button>
        </div>
        {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
        {!accounts ? (
          <p className="text-xs text-gray-600 flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" />
            アカウント一覧を取得中…（10秒ほどかかります）
          </p>
        ) : (
          <>
            <div className="max-h-72 overflow-y-auto space-y-1 mb-3">
              {accounts.map((a) => (
                <label
                  key={a.id}
                  className="flex items-center gap-2.5 text-sm text-gray-200 rounded-lg px-2 py-1.5 hover:bg-neutral-900 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={!!checked[a.id]}
                    onChange={(e) => setChecked((m) => ({ ...m, [a.id]: e.target.checked }))}
                    className="accent-sky-500"
                  />
                  <span className="truncate">{a.name}</span>
                  <span className="ml-auto text-[10px] text-gray-600 shrink-0">{a.id}</span>
                </label>
              ))}
            </div>
            <button
              onClick={submit}
              disabled={busy || Object.values(checked).every((v) => !v)}
              className="w-full flex items-center justify-center gap-1.5 text-sm bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white rounded-lg py-2"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : null}
              {busy ? "接続と初回同期を実行中…（アカウント数×10秒ほど）" : "チェックしたアカウントを接続"}
            </button>
            <p className="text-[10px] text-gray-600 mt-2">
              接続済みのアカウントは自動でスキップされます。不要になった接続はカードのゴミ箱で個別に削除できます。
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ── 運用チェック（検索語句×AI除外・計測ヘルス・学習期間ガード） ──

interface SearchTermView {
  id: string;
  campaignExternalId: string;
  campaignName: string;
  term: string;
  impressions: number;
  clicks: number;
  costYen: number;
  conversions: number;
  aiVerdict: string | null;
  aiReason: string | null;
  status: string;
}

interface HealthView {
  trackingStatus: string;
  actions: { name: string; category: string; primary: boolean; countingType: string; hasValue: boolean }[];
}

interface ChangeView {
  at: string;
  resourceType: string;
  operation: string;
}

function OpsCheckModal({ conn, onClose }: { conn: ConnectionView; onClose: () => void }) {
  const [terms, setTerms] = useState<SearchTermView[]>([]);
  const [health, setHealth] = useState<HealthView | null>(null);
  const [changes, setChanges] = useState<ChangeView[] | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadTerms = async () => {
    const res = await fetch(`/api/connections/${conn.id}/search-terms`);
    const json = (await res.json().catch(() => ({}))) as { terms?: SearchTermView[] };
    if (res.ok) setTerms(json.terms ?? []);
  };

  useEffect(() => {
    loadTerms();
    (async () => {
      const res = await fetch(`/api/connections/${conn.id}/health`);
      const json = (await res.json().catch(() => ({}))) as {
        health?: HealthView;
        changes?: ChangeView[];
        error?: string;
      };
      if (res.ok) {
        setHealth(json.health ?? null);
        setChanges(json.changes ?? []);
      } else {
        setHealthError(json.error ?? "運用チェックの取得に失敗しました");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.id]);

  const act = async (
    key: string,
    fn: () => Promise<Response>,
    after?: (json: Record<string, unknown>) => Promise<void>
  ) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fn();
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "エラーが発生しました");
        return;
      }
      if (after) await after(json);
    } catch {
      setError("通信に失敗しました。時間をおいて再試行してください。");
    } finally {
      setBusy(null);
    }
  };

  const syncTerms = () =>
    act(
      "sync",
      () => fetch(`/api/connections/${conn.id}/search-terms`, { method: "POST" }),
      async (json) => {
        await loadTerms();
        const n = Number(json.synced ?? 0);
        setNotice(
          n > 0
            ? `検索語句を${n}件取得しました`
            : "検索語句が0件でした（直近30日に検索面の配信が無い可能性があります）"
        );
      }
    );

  const classify = () =>
    act(
      "classify",
      () => fetch(`/api/connections/${conn.id}/search-terms/classify`, { method: "POST" }),
      async (json) => {
        await loadTerms();
        setNotice(`AIが${Number(json.classified ?? 0)}件を分類しました`);
      }
    );

  const exclude = (t: SearchTermView) => {
    if (!confirm(`「${t.term}」を\nキャンペーン「${t.campaignName}」の除外キーワード（完全一致）に登録しますか？`)) return;
    act(
      `ex-${t.id}`,
      () =>
        fetch(`/api/connections/${conn.id}/search-terms/exclude`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaignExternalId: t.campaignExternalId, term: t.term, matchType: "EXACT" }),
        }),
      loadTerms
    );
  };

  const verdictBadge = (t: SearchTermView) => {
    if (t.status === "excluded")
      return <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-gray-500">除外済み</span>;
    if (t.aiVerdict === "exclude")
      return <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-950 text-red-300 border border-red-900">除外推奨</span>;
    if (t.aiVerdict === "promote")
      return <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-900">昇格候補</span>;
    if (t.aiVerdict === "keep")
      return <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-gray-400">継続</span>;
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-900 text-gray-600">未分類</span>;
  };

  const healthIssues: string[] = [];
  if (health) {
    if (health.trackingStatus === "NOT_CONVERSION_TRACKED") {
      healthIssues.push("コンバージョン計測が未設定です（自動入札が学習できません）");
    }
    if (health.actions.length > 0 && !health.actions.some((a) => a.primary)) {
      healthIssues.push("メイン（primary）のコンバージョンアクションがありません");
    }
    for (const a of health.actions.filter((a) => a.primary && !a.hasValue)) {
      healthIssues.push(`「${a.name}」に固定値なし（動的値を送っていない場合は value 入札が使えません）`);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-y-auto p-4 sm:p-8" onClick={onClose}>
      <div
        className="w-full max-w-3xl bg-neutral-950 border border-neutral-800 rounded-xl p-5 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={16} className="text-sky-400" />
          <h3 className="text-white font-semibold text-sm">運用チェック — {conn.accountName}</h3>
          <button onClick={onClose} className="ml-auto text-gray-500 hover:text-white">
            <XIcon size={16} />
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2 mb-3 text-xs bg-red-950/60 border border-red-900 text-red-300">
            <AlertTriangle size={13} className="shrink-0" />
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-lg px-3 py-2 mb-3 text-xs bg-emerald-950/60 border border-emerald-800 text-emerald-300">
            {notice}
          </div>
        )}

        {/* 学習期間ガード */}
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-gray-400 mb-1.5">学習期間ガード（直近7日の設定変更）</h4>
          {changes === null && !healthError ? (
            <p className="text-xs text-gray-600 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />確認中…</p>
          ) : healthError ? (
            <p className="text-xs text-red-400/80">{healthError}</p>
          ) : changes && changes.length > 0 ? (
            <div className="rounded-lg px-3 py-2 text-xs bg-amber-950/40 border border-amber-900/60 text-amber-200">
              直近7日間に <strong>{changes.length}件</strong> の設定変更があります。自動入札の学習期間中の可能性が高いため、
              追加の変更（予算・入札・ステータス）は学習をリセットする恐れがあります。
              <ul className="mt-1.5 space-y-0.5 text-amber-200/70">
                {changes.slice(0, 5).map((c, i) => (
                  <li key={i}>・{c.at.slice(0, 16)} {c.resourceType} {c.operation}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-emerald-400/80">直近7日間の設定変更はありません。学習は安定していると考えられます。</p>
          )}
        </div>

        {/* 計測ヘルスチェック */}
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-gray-400 mb-1.5">計測ヘルスチェック</h4>
          {!health && !healthError ? (
            <p className="text-xs text-gray-600 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />確認中…</p>
          ) : health ? (
            <div className="text-xs space-y-1.5">
              {healthIssues.length === 0 ? (
                <p className="text-emerald-400/80">計測設定に大きな問題は見つかりませんでした。</p>
              ) : (
                <ul className="space-y-1">
                  {healthIssues.map((h, i) => (
                    <li key={i} className="text-amber-300 flex items-start gap-1.5">
                      <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                      {h}
                    </li>
                  ))}
                </ul>
              )}
              <div className="text-gray-500">
                有効なCVアクション: {health.actions.length}件
                {health.actions.slice(0, 6).map((a) => (
                  <span key={a.name} className="inline-block ml-2 text-gray-400">
                    {a.name}
                    {a.primary && <span className="text-sky-400">（メイン）</span>}
                    {a.hasValue ? <span className="text-emerald-500/80">・値あり</span> : null}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* 検索語句レポート */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h4 className="text-xs font-semibold text-gray-400">検索語句レポート（直近30日・消化額順）</h4>
            <div className="ml-auto flex gap-2">
              <button
                onClick={syncTerms}
                disabled={busy !== null}
                className="flex items-center gap-1 text-[11px] bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-gray-200 rounded px-2 py-1"
              >
                {busy === "sync" ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                語句を同期
              </button>
              <button
                onClick={classify}
                disabled={busy !== null || terms.length === 0}
                className="flex items-center gap-1 text-[11px] bg-sky-800 hover:bg-sky-700 disabled:opacity-50 text-white rounded px-2 py-1"
              >
                {busy === "classify" ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                AIで分類
              </button>
            </div>
          </div>

          {terms.length === 0 ? (
            <p className="text-xs text-gray-600">
              まだ検索語句がありません。「語句を同期」で媒体から取得してください。
            </p>
          ) : (
            <div className="overflow-x-auto max-h-80 overflow-y-auto border border-neutral-800 rounded-lg">
              <table className="w-full text-xs">
                <thead className="text-gray-500 sticky top-0 bg-neutral-950">
                  <tr className="[&>th]:px-2.5 [&>th]:py-1.5 [&>th]:text-left [&>th]:font-normal">
                    <th>検索語句</th>
                    <th>キャンペーン</th>
                    <th className="!text-right">消化額</th>
                    <th className="!text-right">Click</th>
                    <th className="!text-right">CV</th>
                    <th>AI判定</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  {terms.map((t) => (
                    <tr key={t.id} className="border-t border-neutral-900">
                      <td className="px-2.5 py-1.5 max-w-[180px]">
                        <span className="text-gray-200">{t.term}</span>
                        {t.aiReason && <p className="text-[10px] text-gray-600">{t.aiReason}</p>}
                      </td>
                      <td className="px-2.5 py-1.5 max-w-[130px] truncate text-gray-500">{t.campaignName}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">{yen(t.costYen)}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">{num(t.clicks)}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">{t.conversions.toFixed(1)}</td>
                      <td className="px-2.5 py-1.5">{verdictBadge(t)}</td>
                      <td className="px-2.5 py-1.5 text-right">
                        {t.status !== "excluded" && (
                          <button
                            onClick={() => exclude(t)}
                            disabled={busy !== null}
                            className={clsx(
                              "text-[10px] rounded px-1.5 py-0.5 border disabled:opacity-50",
                              t.aiVerdict === "exclude"
                                ? "border-red-900 bg-red-950/60 text-red-300 hover:bg-red-900/60"
                                : "border-neutral-700 text-gray-400 hover:text-white"
                            )}
                          >
                            除外
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 左サイドバー（セクションナビ） ─────────────────────

const NAV_ITEMS: { id: string; label: string; icon: typeof Plug }[] = [
  { id: "sec-kpi", label: "ダッシュボード", icon: BarChart3 },
  { id: "sec-connect", label: "媒体接続", icon: Plug },
  { id: "sec-platforms", label: "媒体別パフォーマンス", icon: FileText },
  { id: "sec-campaigns", label: "キャンペーン", icon: Play },
  { id: "sec-insights", label: "AI インサイト", icon: Sparkles },
];

function Sidebar({ active, onNavigate }: { active: string; onNavigate: (id: string) => void }) {
  return (
    <aside className="hidden lg:flex flex-col fixed left-0 top-0 bottom-0 w-56 bg-neutral-950 border-r border-neutral-800 p-4 z-40">
      <div className="flex items-center gap-2.5 mb-6 px-1">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-sky-600 via-cyan-500 to-emerald-400 flex items-center justify-center text-white font-black text-xs">
          AD
        </div>
        <div>
          <p className="text-white font-bold text-sm leading-tight">Ad Agent</p>
          <p className="text-[10px] text-gray-500 leading-tight">統合ダッシュボード</p>
        </div>
      </div>
      <nav className="space-y-1">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={clsx(
              "w-full flex items-center gap-2.5 text-sm rounded-lg px-3 py-2 transition-colors text-left",
              active === item.id
                ? "bg-neutral-800 text-white"
                : "text-gray-400 hover:text-white hover:bg-neutral-900"
            )}
          >
            <item.icon size={15} className="shrink-0" />
            {item.label}
          </button>
        ))}
      </nav>
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="mt-auto flex items-center gap-2.5 text-sm text-gray-500 hover:text-gray-300 px-3 py-2"
      >
        <LogOut size={15} />
        ログアウト
      </button>
    </aside>
  );
}

// ── メイン ─────────────────────────────────────────────

export function DashboardClient({ data }: { data: DashboardData }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [openInsight, setOpenInsight] = useState<string | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [opsConn, setOpsConn] = useState<ConnectionView | null>(null);
  const [pickerConn, setPickerConn] = useState<ConnectionView | null>(null);
  const [activeNav, setActiveNav] = useState("sec-kpi");

  const navigate = (id: string) => {
    setActiveNav(id);
    if (id === "sec-connect") setShowConnect(true);
    // 接続パネルは開いた直後にDOMへ現れるため、描画後にスクロールする
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }));
  };

  const platformOf = useMemo(() => new Map(data.platforms.map((p) => [p.id, p])), [data.platforms]);
  const hasConnections = data.platforms.some((p) => p.connections.length > 0);
  const derived = kpiDerived(data.totals);

  // OAuth コールバックからの戻り（?connected= / ?connect_error=）
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const connected = sp.get("connected");
    const error = sp.get("connect_error");
    if (connected) setBanner({ kind: "ok", text: `${platformOf.get(connected)?.label ?? connected} を接続しました` });
    if (error) setBanner({ kind: "error", text: `接続に失敗しました: ${error}` });
    if (connected || error) window.history.replaceState(null, "", "/");
  }, [platformOf]);

  async function call(key: string, fn: () => Promise<Response>) {
    setBusy(key);
    try {
      const res = await fn();
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setBanner({ kind: "error", text: json.error ?? "エラーが発生しました" });
      } else {
        setBanner(null);
        router.refresh();
      }
      return res.ok;
    } finally {
      setBusy(null);
    }
  }

  const connectDemo = (platform: string) =>
    call(`demo-${platform}`, () =>
      fetch(`/api/platforms/${platform}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "demo" }),
      })
    );

  const syncConnection = (id: string) => call(`sync-${id}`, () => fetch(`/api/connections/${id}/sync`, { method: "POST" }));

  const disconnect = (id: string, label: string) => {
    if (!confirm(`${label} の接続を解除しますか？（取得済みの実績データも削除されます）`)) return;
    call(`del-${id}`, () => fetch(`/api/connections/${id}`, { method: "DELETE" }));
  };

  // アカウント選択はチェックボックス式モーダル（AccountPickerModal）で複数を追加接続する

  const setMonthlyBudget = (conn: ConnectionView, label: string) => {
    const input = prompt(`${label} の月予算（円・空欄で解除）`, conn.monthlyBudgetYen ? String(conn.monthlyBudgetYen) : "");
    if (input === null) return;
    const v = input.trim() === "" ? null : Number(input.replace(/[,¥]/g, ""));
    if (v !== null && (!Number.isFinite(v) || v < 0)) return;
    call(`budget-${conn.id}`, () =>
      fetch(`/api/connections/${conn.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyBudgetYen: v }),
      })
    );
  };

  const toggleCampaign = (c: CampaignRow) =>
    call(`camp-${c.id}`, () =>
      fetch(`/api/campaigns/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: c.status === "active" ? "paused" : "active" }),
      })
    );

  const editCampaignBudget = (c: CampaignRow) => {
    const input = prompt(`「${c.name}」の日予算（円）`, c.dailyBudgetYen ? String(c.dailyBudgetYen) : "");
    if (input === null) return;
    const v = Number(input.replace(/[,¥]/g, ""));
    if (!Number.isFinite(v) || v <= 0) return;
    call(`campb-${c.id}`, () =>
      fetch(`/api/campaigns/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyBudgetYen: v }),
      })
    );
  };

  const generateInsight = () =>
    call("insight", () =>
      fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: data.days }),
      })
    );

  const markInsight = (id: string, status: "read" | "dismissed") =>
    call(`ins-${id}-${status}`, () =>
      fetch(`/api/insights/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
    );

  const kpis: { label: string; value: string; sub?: string }[] = [
    { label: "消化額", value: yen(data.totals.costYen) },
    { label: "表示回数", value: num(data.totals.impressions) },
    { label: "クリック", value: num(data.totals.clicks), sub: `CTR ${pct(derived.ctr)} / CPC ${yen(derived.cpc)}` },
    { label: "CV", value: data.totals.conversions.toFixed(1) },
    { label: "CPA", value: derived.cpa ? yen(derived.cpa) : "—" },
    { label: "ROAS", value: `${Math.round(derived.roas * 100)}%`, sub: `CV価値 ${yen(data.totals.conversionValueYen)}` },
  ];

  return (
    <div className="min-h-screen">
      <Sidebar active={activeNav} onNavigate={navigate} />
      <div className="lg:pl-56">
        <div className="min-h-screen max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-24">
      {/* ヘッダー */}
      <header className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex items-center gap-2.5 mr-auto">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-sky-600 via-cyan-500 to-emerald-400 flex items-center justify-center text-white font-black text-sm">
            AD
          </div>
          <div>
            <h1 className="text-lg font-bold text-white leading-tight">Ad Agent</h1>
            <p className="text-[11px] text-gray-500 leading-tight">広告媒体 統合ダッシュボード</p>
          </div>
        </div>

        <div className="flex rounded-lg border border-neutral-800 overflow-hidden text-sm">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => router.push(d === 30 ? "/" : `/?days=${d}`)}
              className={clsx(
                "px-3 py-1.5 transition-colors",
                data.days === d ? "bg-neutral-800 text-white" : "text-gray-400 hover:text-white"
              )}
            >
              {d}日
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowConnect((v) => !v)}
          className="flex items-center gap-1.5 text-sm bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-gray-200 px-3 py-1.5 rounded-lg transition-colors"
        >
          <Plug size={15} />
          媒体接続
        </button>

        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="text-gray-500 hover:text-gray-300 p-1.5"
          title="ログアウト"
        >
          <LogOut size={16} />
        </button>
      </header>

      {banner && (
        <div
          className={clsx(
            "flex items-center gap-2 rounded-lg px-4 py-2.5 mb-4 text-sm",
            banner.kind === "ok"
              ? "bg-emerald-950/60 border border-emerald-800 text-emerald-300"
              : "bg-red-950/60 border border-red-900 text-red-300"
          )}
        >
          {banner.kind === "error" && <AlertTriangle size={15} className="shrink-0" />}
          <span className="flex-1">{banner.text}</span>
          <button onClick={() => setBanner(null)} className="text-current/70 hover:text-current">
            <XIcon size={14} />
          </button>
        </div>
      )}

      {opsConn && <OpsCheckModal conn={opsConn} onClose={() => setOpsConn(null)} />}
      {pickerConn && (
        <AccountPickerModal
          conn={pickerConn}
          onClose={() => setPickerConn(null)}
          onDone={(msg) => {
            setPickerConn(null);
            setBanner({ kind: "ok", text: msg });
            router.refresh();
          }}
        />
      )}

      {/* 接続パネル（トグル or 未接続時は常時） */}
      {(showConnect || !hasConnections) && (
        <section id="sec-connect" className="scroll-mt-6 mb-6 bg-neutral-950 border border-neutral-800 rounded-xl p-4 sm:p-5">
          <h2 className="text-white font-semibold mb-1 flex items-center gap-2">
            <Plug size={16} className="text-sky-400" />
            広告媒体の接続
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            実API接続は各媒体の開発者資格情報（環境変数）が必要です。未設定の媒体は「デモ接続」で全機能を試せます。
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.platforms.map((p) => (
              <div key={p.id} className="border border-neutral-800 rounded-lg p-3.5 bg-black/40">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
                  <span className="text-sm font-medium text-white">{p.label}</span>
                  <span className="ml-auto text-[10px] text-gray-600">{p.apiName}</span>
                </div>

                {p.connections.length === 0 ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => connectDemo(p.id)}
                      disabled={busy === `demo-${p.id}`}
                      className="flex-1 flex items-center justify-center gap-1.5 text-xs bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-gray-200 rounded-md py-1.5 transition-colors"
                    >
                      {busy === `demo-${p.id}` ? <Loader2 size={12} className="animate-spin" /> : null}
                      デモ接続
                    </button>
                    {p.apiAvailable ? (
                      <a
                        href={`/api/platforms/${p.id}/connect`}
                        className="flex-1 flex items-center justify-center gap-1.5 text-xs bg-sky-700 hover:bg-sky-600 text-white rounded-md py-1.5 transition-colors"
                      >
                        API接続
                      </a>
                    ) : (
                      <span className="flex-1 flex items-center justify-center text-[10px] text-gray-600 border border-neutral-800 rounded-md py-1.5" title={p.note ?? undefined}>
                        API未設定
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {p.connections.map((c) => (
                      <div key={c.id} className="text-xs">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={clsx(
                              "w-1.5 h-1.5 rounded-full shrink-0",
                              c.status === "connected" ? "bg-emerald-400" : "bg-red-400"
                            )}
                          />
                          <span className="text-gray-300 truncate">{c.accountName}</span>
                          <span className="text-[10px] text-gray-600 shrink-0">{c.mode === "demo" ? "デモ" : "API"}</span>
                        </div>
                        {c.lastError && <p className="text-red-400/80 text-[10px] mt-0.5 line-clamp-2">{c.lastError}</p>}
                        <div className="flex items-center gap-2 mt-1.5 text-[11px]">
                          <button
                            onClick={() => syncConnection(c.id)}
                            disabled={busy === `sync-${c.id}`}
                            className="flex items-center gap-1 text-gray-400 hover:text-white disabled:opacity-50"
                          >
                            <RefreshCw size={11} className={busy === `sync-${c.id}` ? "animate-spin" : ""} />
                            同期
                          </button>
                          <button onClick={() => setMonthlyBudget(c, p.label)} className="text-gray-400 hover:text-white">
                            月予算{c.monthlyBudgetYen ? ` ${yen(c.monthlyBudgetYen)}` : "未設定"}
                          </button>
                          {p.id === "google" && c.mode === "api" && (
                            <>
                              <button
                                onClick={() => setPickerConn(c)}
                                className="text-gray-400 hover:text-white"
                                title="MCC配下のアカウントをチェックして追加接続"
                              >
                                アカウント追加
                              </button>
                              <button
                                onClick={() => setOpsConn(c)}
                                className="text-sky-400/80 hover:text-sky-300"
                                title="検索語句のAI除外提案・計測ヘルス・学習期間チェック"
                              >
                                運用チェック
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => disconnect(c.id, p.label)}
                            className="ml-auto text-gray-600 hover:text-red-400"
                            title="接続解除"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {hasConnections && (
        <>
          {/* KPI カード */}
          <section id="sec-kpi" className="scroll-mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            {kpis.map((k) => (
              <div key={k.label} className="bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3">
                <p className="text-[11px] text-gray-500">{k.label}</p>
                <p className="text-lg font-bold text-white tabular-nums leading-snug">{k.value}</p>
                {k.sub && <p className="text-[10px] text-gray-600 mt-0.5">{k.sub}</p>}
              </div>
            ))}
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 space-y-6 min-w-0">
              {/* トレンド */}
              <section className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 sm:p-5">
                <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
                  <BarChart3 size={16} className="text-sky-400" />
                  日別消化額（媒体別）
                </h2>
                <TrendChart daily={data.daily} platforms={data.platforms} />
              </section>

              {/* 媒体別テーブル */}
              <section id="sec-platforms" className="scroll-mt-6 bg-neutral-950 border border-neutral-800 rounded-xl p-4 sm:p-5">
                <h2 className="text-white font-semibold mb-3">媒体別パフォーマンス</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead>
                      <tr className="text-[11px] text-gray-500 border-b border-neutral-800">
                        <th className="text-left font-normal py-2 pr-3">媒体</th>
                        <th className="text-right font-normal py-2 px-3">消化額</th>
                        <th className="text-right font-normal py-2 px-3">IMP</th>
                        <th className="text-right font-normal py-2 px-3">Click</th>
                        <th className="text-right font-normal py-2 px-3">CTR</th>
                        <th className="text-right font-normal py-2 px-3">CPC</th>
                        <th className="text-right font-normal py-2 px-3">CV</th>
                        <th className="text-right font-normal py-2 px-3">CPA</th>
                        <th className="text-right font-normal py-2 pl-3">ROAS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.platformAgg.map((row) => {
                        const p = platformOf.get(row.platform);
                        const d = kpiDerived(row);
                        return (
                          <tr key={row.platform} className="border-b border-neutral-900 last:border-0">
                            <td className="py-2.5 pr-3">
                              <span className="inline-flex items-center gap-2 text-gray-200">
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p?.color }} />
                                {p?.label ?? row.platform}
                              </span>
                            </td>
                            <td className="text-right px-3 tabular-nums text-gray-200">{yen(row.costYen)}</td>
                            <td className="text-right px-3 tabular-nums text-gray-400">{num(row.impressions)}</td>
                            <td className="text-right px-3 tabular-nums text-gray-400">{num(row.clicks)}</td>
                            <td className="text-right px-3 tabular-nums text-gray-400">{pct(d.ctr)}</td>
                            <td className="text-right px-3 tabular-nums text-gray-400">{yen(d.cpc)}</td>
                            <td className="text-right px-3 tabular-nums text-gray-200">{row.conversions.toFixed(1)}</td>
                            <td className="text-right px-3 tabular-nums text-gray-200">{d.cpa ? yen(d.cpa) : "—"}</td>
                            <td className="text-right pl-3 tabular-nums text-gray-200">{Math.round(d.roas * 100)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* キャンペーンテーブル */}
              <section id="sec-campaigns" className="scroll-mt-6 bg-neutral-950 border border-neutral-800 rounded-xl p-4 sm:p-5">
                <h2 className="text-white font-semibold mb-1">キャンペーン</h2>
                <p className="text-[11px] text-gray-600 mb-3">
                  配信/停止の切替と日予算の変更ができます（API接続時は媒体へ即時反映）
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead>
                      <tr className="text-[11px] text-gray-500 border-b border-neutral-800">
                        <th className="text-left font-normal py-2 pr-3">キャンペーン</th>
                        <th className="text-center font-normal py-2 px-3">状態</th>
                        <th className="text-right font-normal py-2 px-3">日予算</th>
                        <th className="text-right font-normal py-2 px-3">消化額</th>
                        <th className="text-right font-normal py-2 px-3">CV</th>
                        <th className="text-right font-normal py-2 px-3">CPA</th>
                        <th className="text-right font-normal py-2 pl-3">ROAS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.campaigns.map((c) => {
                        const p = platformOf.get(c.platform);
                        const d = kpiDerived(c);
                        const toggling = busy === `camp-${c.id}`;
                        return (
                          <tr key={c.id} className="border-b border-neutral-900 last:border-0">
                            <td className="py-2.5 pr-3 max-w-[260px]">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p?.color }} />
                                <span className="text-gray-200 truncate" title={c.name}>{c.name}</span>
                              </div>
                            </td>
                            <td className="text-center px-3">
                              <button
                                onClick={() => toggleCampaign(c)}
                                disabled={toggling}
                                className={clsx(
                                  "inline-flex items-center gap-1 text-[11px] rounded-full px-2.5 py-1 border transition-colors disabled:opacity-50",
                                  c.status === "active"
                                    ? "border-emerald-800 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-950"
                                    : "border-neutral-700 bg-neutral-900 text-gray-400 hover:text-gray-200"
                                )}
                                title={c.status === "active" ? "クリックで停止" : "クリックで配信再開"}
                              >
                                {toggling ? (
                                  <Loader2 size={10} className="animate-spin" />
                                ) : c.status === "active" ? (
                                  <Play size={10} />
                                ) : (
                                  <Pause size={10} />
                                )}
                                {c.status === "active" ? "配信中" : "停止中"}
                              </button>
                            </td>
                            <td className="text-right px-3 tabular-nums">
                              <button
                                onClick={() => editCampaignBudget(c)}
                                className="text-gray-300 hover:text-sky-300 hover:underline decoration-dotted underline-offset-2"
                                title="クリックで日予算を変更"
                              >
                                {c.dailyBudgetYen ? yen(c.dailyBudgetYen) : "—"}
                              </button>
                            </td>
                            <td className="text-right px-3 tabular-nums text-gray-200">{yen(c.costYen)}</td>
                            <td className="text-right px-3 tabular-nums text-gray-400">{c.conversions.toFixed(1)}</td>
                            <td className="text-right px-3 tabular-nums text-gray-400">{d.cpa ? yen(d.cpa) : "—"}</td>
                            <td className="text-right pl-3 tabular-nums text-gray-400">{Math.round(d.roas * 100)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            {/* 右カラム: AI インサイト */}
            <div className="space-y-4 min-w-0">
              <section id="sec-insights" className="scroll-mt-6 bg-neutral-950 border border-neutral-800 rounded-xl p-4 sm:p-5">
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-white font-semibold flex items-center gap-2">
                    <Sparkles size={16} className="text-cyan-400" />
                    AI インサイト
                  </h2>
                  <button
                    onClick={generateInsight}
                    disabled={busy === "insight" || !data.aiConfigured}
                    className="ml-auto flex items-center gap-1.5 text-xs bg-cyan-800 hover:bg-cyan-700 disabled:opacity-50 text-white rounded-md px-2.5 py-1.5 transition-colors"
                    title={data.aiConfigured ? `直近${data.days}日の実績を分析` : "ANTHROPIC_API_KEY が未設定です"}
                  >
                    {busy === "insight" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    レポート生成
                  </button>
                </div>

                {data.insights.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    まだインサイトがありません。「レポート生成」で直近実績のAI分析レポートを作成できます。
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {data.insights.map((ins) => {
                      const open = openInsight === ins.id;
                      const isAlert = ins.kind === "alert";
                      return (
                        <div
                          key={ins.id}
                          className={clsx(
                            "border rounded-lg overflow-hidden",
                            isAlert ? "border-amber-900/70 bg-amber-950/20" : "border-neutral-800 bg-black/40"
                          )}
                        >
                          <button
                            onClick={() => {
                              setOpenInsight(open ? null : ins.id);
                              if (!open && ins.status === "new") markInsight(ins.id, "read");
                            }}
                            className="w-full flex items-start gap-2 px-3.5 py-3 text-left"
                          >
                            {isAlert ? (
                              <AlertTriangle size={15} className="text-amber-400 shrink-0 mt-0.5" />
                            ) : (
                              <FileText size={15} className="text-cyan-400 shrink-0 mt-0.5" />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className={clsx("block text-sm", ins.status === "new" ? "text-white font-medium" : "text-gray-300")}>
                                {ins.title}
                              </span>
                              <span className="block text-[10px] text-gray-600 mt-0.5">
                                {new Date(ins.createdAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </span>
                            {ins.status === "new" && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0 mt-1.5" />}
                          </button>
                          {open && (
                            <div className="px-4 pb-3.5 border-t border-neutral-800/60 pt-3">
                              <Markdown text={ins.body} />
                              <div className="flex justify-end mt-3">
                                <button
                                  onClick={() => markInsight(ins.id, "dismissed")}
                                  className="text-[11px] text-gray-500 hover:text-gray-300"
                                >
                                  この項目を非表示
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </div>
        </>
      )}
        </div>
      </div>
    </div>
  );
}
