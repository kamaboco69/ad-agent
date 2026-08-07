"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Upload, Users, X as XIcon, SlidersHorizontal, Trash2 } from "lucide-react";
import clsx from "clsx";
import type { LeadKpi, CohortRow, ColumnMap, LeadRules } from "@/lib/leads";

export interface LeadRow {
  id: string;
  email: string | null;
  companyName: string | null;
  personName: string | null;
  memo: string | null;
  validity: string;
  invalidReason: string | null;
  stage: string;
  lost: boolean;
  overridden: boolean;
  dealAmountYen: number | null;
  leadAt: string;
  campaignName: string | null;
  hasGclid: boolean;
}

const yen = (v: number) => `¥${Math.round(v).toLocaleString()}`;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const num = (v: number) => v.toLocaleString();

const STAGES = [
  { id: "lead", label: "リード" },
  { id: "mql", label: "MQL" },
  { id: "meeting", label: "商談" },
  { id: "won", label: "受注" },
];

// ── CSVインポート（プレビューでカラム対応を確認してから取り込む） ──

const FIELD_LABELS: { key: keyof ColumnMap; label: string; hint?: string }[] = [
  { key: "externalKey", label: "一意キー", hint: "CRMのレコードID等。無ければメール＋日付で代用します" },
  { key: "email", label: "メールアドレス" },
  { key: "companyName", label: "会社名" },
  { key: "personName", label: "氏名" },
  { key: "leadAt", label: "リード獲得日" },
  { key: "stage", label: "ステータス", hint: "商談・受注・失注などの文言から自動で段階を判定します" },
  { key: "dealAmount", label: "受注金額" },
  { key: "memo", label: "問い合わせ内容" },
  { key: "gclid", label: "GCLID", hint: "Google広告へ受注データを戻す際に必要です" },
  { key: "campaignName", label: "キャンペーン名" },
  { key: "campaignExternalId", label: "キャンペーンID" },
];

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[] | null>(null);
  const [map, setMap] = useState<ColumnMap>({});
  const [sample, setSample] = useState<Record<string, string>[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preview = async (f: File) => {
    setBusy("preview");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/leads?preview=1", { method: "POST", body: fd });
      const json = (await res.json().catch(() => ({}))) as {
        headers?: string[]; guessed?: ColumnMap; sample?: Record<string, string>[]; totalRows?: number; error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "CSVを読み取れませんでした");
        return;
      }
      setFile(f);
      setHeaders(json.headers ?? []);
      setMap(json.guessed ?? {});
      setSample(json.sample ?? []);
      setTotalRows(json.totalRows ?? 0);
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!file) return;
    setBusy("import");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("columnMap", JSON.stringify(map));
      const res = await fetch("/api/leads", { method: "POST", body: fd });
      const json = (await res.json().catch(() => ({}))) as {
        created?: number; updated?: number; skipped?: number; errors?: string[]; error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "取込に失敗しました");
        return;
      }
      const skipped = json.skipped ?? 0;
      onDone(
        `${json.created ?? 0}件を新規登録・${json.updated ?? 0}件を更新しました${skipped ? `（${skipped}件はスキップ）` : ""}`
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-100/50 flex items-start justify-center overflow-y-auto p-4 sm:p-8" onClick={onClose}>
      <div className="w-full max-w-3xl bg-white border border-gray-200 rounded-xl shadow-sm p-5 my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <Upload size={15} className="text-sky-700" />
          <h3 className="text-gray-900 font-semibold text-sm">リードCSVの取り込み</h3>
          <button onClick={onClose} className="ml-auto text-gray-500 hover:text-gray-900"><XIcon size={16} /></button>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2 mb-3 text-xs bg-red-50 border border-red-300 text-red-700">
            <AlertTriangle size={13} className="shrink-0" />
            {error}
          </div>
        )}

        {!headers ? (
          <div>
            <p className="text-xs text-gray-600 mb-3">
              CRM やスプレッドシートから書き出した CSV を選んでください。1行目をヘッダ行として読み取ります。
              文字コードは UTF-8 / Shift_JIS のどちらでも構いません。
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) preview(f);
              }}
              className="text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-sky-700 file:px-3 file:py-1.5 file:text-white hover:file:bg-sky-600"
            />
            {busy === "preview" && (
              <p className="text-xs text-gray-600 flex items-center gap-1.5 mt-3">
                <Loader2 size={12} className="animate-spin" />読み取り中…
              </p>
            )}
          </div>
        ) : (
          <>
            <p className="text-xs text-gray-600 mb-3">
              {totalRows.toLocaleString()}行を検出しました。列の対応を確認してください（推測が外れていれば選び直せます）。
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4 max-h-64 overflow-y-auto pr-1">
              {FIELD_LABELS.map((f) => (
                <label key={f.key} className="text-xs">
                  <span className="block text-gray-700 mb-0.5">{f.label}</span>
                  <select
                    value={map[f.key] ?? ""}
                    onChange={(e) => setMap((m) => ({ ...m, [f.key]: e.target.value || undefined }))}
                    className="w-full border border-gray-300 rounded-md px-2 py-1 bg-white text-gray-800"
                  >
                    <option value="">（使わない）</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                  {f.hint && <span className="block text-[10px] text-gray-500 mt-0.5">{f.hint}</span>}
                </label>
              ))}
            </div>

            {sample.length > 0 && map.email && (
              <div className="text-[11px] text-gray-600 mb-3">
                先頭行の読み取り例: {map.companyName ? `${sample[0][map.companyName] || "（会社名なし）"} / ` : ""}
                {sample[0][map.email] || "（メールなし）"}
                {map.stage ? ` / ${sample[0][map.stage] || "-"}` : ""}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => { setHeaders(null); setFile(null); }}
                className="text-xs border border-gray-300 rounded-md px-3 py-2 text-gray-700 hover:bg-gray-100"
              >
                ファイルを選び直す
              </button>
              <button
                onClick={submit}
                disabled={busy !== null || !map.email}
                className="flex-1 flex items-center justify-center gap-1.5 text-sm bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white rounded-lg py-2"
              >
                {busy === "import" ? <Loader2 size={13} className="animate-spin" /> : null}
                {busy === "import" ? "取り込み中…" : `${totalRows.toLocaleString()}行を取り込む`}
              </button>
            </div>
            {!map.email && <p className="text-[11px] text-amber-700 mt-2">メールアドレスの列を指定してください（重複判定に使います）。</p>}
          </>
        )}
      </div>
    </div>
  );
}

// ── 判定ルール設定 ──────────────────────────────────

function RulesModal({ rules, onClose, onDone }: { rules: LeadRules; onClose: () => void; onDone: (msg: string) => void }) {
  const [form, setForm] = useState(rules);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/leads/rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = (await res.json().catch(() => ({}))) as { rejudged?: number };
      if (res.ok) onDone(`ルールを保存し、${json.rejudged ?? 0}件を再判定しました（手動修正したリードは変更していません）`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-100/50 flex items-start justify-center overflow-y-auto p-4 sm:p-8" onClick={onClose}>
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-5 my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <SlidersHorizontal size={15} className="text-sky-700" />
          <h3 className="text-gray-900 font-semibold text-sm">有効リードの判定ルール</h3>
          <button onClick={onClose} className="ml-auto text-gray-500 hover:text-gray-900"><XIcon size={16} /></button>
        </div>
        <p className="text-xs text-gray-600 mb-3">
          取り込み時に自動判定します。画面で手動修正したリードは、ルールを変えても上書きされません。
        </p>

        <label className="flex items-center gap-2 text-sm text-gray-800 mb-2 cursor-pointer">
          <input type="checkbox" checked={form.freeEmailInvalid} onChange={(e) => setForm({ ...form, freeEmailInvalid: e.target.checked })} className="accent-sky-600" />
          フリーメール（gmail など）を無効リードにする
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-800 mb-3 cursor-pointer">
          <input type="checkbox" checked={form.requireCompany} onChange={(e) => setForm({ ...form, requireCompany: e.target.checked })} className="accent-sky-600" />
          会社名が空のリードを無効にする
        </label>

        <label className="block text-xs text-gray-700 mb-1">除外ドメイン（1行に1つ・競合など）</label>
        <textarea
          value={form.blockedDomains ?? ""}
          onChange={(e) => setForm({ ...form, blockedDomains: e.target.value })}
          rows={3}
          className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm mb-3 font-mono"
          placeholder="competitor.co.jp"
        />
        <label className="block text-xs text-gray-700 mb-1">NGワード（1行に1つ・会社名や問い合わせ内容に含まれたら無効）</label>
        <textarea
          value={form.blockedKeywords ?? ""}
          onChange={(e) => setForm({ ...form, blockedKeywords: e.target.value })}
          rows={4}
          className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm mb-4 font-mono"
        />

        <button onClick={save} disabled={busy} className="w-full flex items-center justify-center gap-1.5 text-sm bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white rounded-lg py-2">
          {busy ? <Loader2 size={13} className="animate-spin" /> : null}
          保存して再判定
        </button>
      </div>
    </div>
  );
}

// ── メイン ──────────────────────────────────────────

export function LeadsClient({
  days, kpi, target, cohorts, leads, rules,
}: {
  days: number;
  kpi: LeadKpi;
  target: { cpo: number | null; cac: number | null; ltv: number | null };
  cohorts: CohortRow[];
  leads: LeadRow[];
  rules: LeadRules;
}) {
  const router = useRouter();
  const [banner, setBanner] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<{ validity: string; stage: string }>({ validity: "", stage: "" });

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setBanner({ kind: "error", text: j.error ?? "更新に失敗しました" });
      } else {
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("このリードを削除しますか？")) return;
    setBusy(id);
    try {
      await fetch(`/api/leads/${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const shown = leads.filter(
    (l) => (!filter.validity || l.validity === filter.validity) && (!filter.stage || l.stage === filter.stage)
  );

  // 目標に対する達成状況（BtoBの実質KPIはCPOとCAC）
  const judge = (actual: number | null, goal: number | null) =>
    actual === null || goal === null ? "" : actual <= goal ? "text-emerald-700" : "text-red-700";

  const tiles: { label: string; value: string; sub?: string; cls?: string }[] = [
    { label: "リード数", value: num(kpi.leads), sub: `広告費 ${yen(kpi.costYen)}` },
    { label: "有効リード率", value: pct(kpi.validRate), sub: `${num(kpi.valid)}件 / ${num(kpi.leads)}件` },
    { label: "商談化率", value: pct(kpi.meetingRate), sub: `商談 ${num(kpi.meetings)}件` },
    { label: "受注率", value: pct(kpi.wonRate), sub: `受注 ${num(kpi.wons)}件` },
    { label: "リード単価", value: kpi.cpl ? yen(kpi.cpl) : "—", sub: `有効リード単価 ${kpi.cpValidLead ? yen(kpi.cpValidLead) : "—"}` },
    {
      label: "商談単価（CPO）",
      value: kpi.cpo ? yen(kpi.cpo) : "—",
      sub: target.cpo ? `目標 ${yen(target.cpo)}` : "目標未設定",
      cls: judge(kpi.cpo, target.cpo),
    },
    {
      label: "受注単価（CAC）",
      value: kpi.cac ? yen(kpi.cac) : "—",
      sub: target.cac ? `目標 ${yen(target.cac)}` : "目標未設定",
      cls: judge(kpi.cac, target.cac),
    },
    {
      label: "LTV / CAC",
      value: kpi.ltvCacRatio ? `${kpi.ltvCacRatio.toFixed(1)}倍` : "—",
      sub: target.ltv ? `想定LTV ${yen(target.ltv)}` : "LTV未設定",
    },
  ];

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-wrap items-center gap-3 mb-1">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Users size={18} className="text-sky-700" />
            リード管理（BtoB）
          </h1>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm bg-white">
            {[30, 90, 180, 365].map((d) => (
              <button
                key={d}
                onClick={() => router.push(d === 90 ? "/leads" : `/leads?days=${d}`)}
                className={clsx("px-3 py-1.5 transition-colors", days === d ? "bg-sky-700 text-white" : "text-gray-500 hover:bg-gray-100")}
              >
                {d}日
              </button>
            ))}
          </div>
          <button onClick={() => setShowRules(true)} className="text-sm border border-gray-300 bg-white rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-100">
            判定ルール
          </button>
          <button onClick={() => setShowImport(true)} className="flex items-center gap-1.5 text-sm bg-sky-700 hover:bg-sky-600 text-white rounded-lg px-3 py-1.5">
            <Upload size={15} />
            CSV取り込み
          </button>
          <a href="/" className="ml-auto text-sm text-gray-600 hover:text-gray-900">← ダッシュボード</a>
        </div>
        <p className="text-xs text-gray-500 mb-6">
          リード単価ではなく<strong>商談単価（CPO）と受注単価（CAC）</strong>が実質的なKPIです。期間はリード獲得日で絞っています。
        </p>

        {banner && (
          <div className={clsx("flex items-center gap-2 rounded-lg px-4 py-2.5 mb-4 text-sm",
            banner.kind === "ok" ? "bg-emerald-50 border border-emerald-300 text-emerald-700" : "bg-red-50 border border-red-300 text-red-700")}>
            {banner.kind === "error" && <AlertTriangle size={15} className="shrink-0" />}
            <span className="flex-1">{banner.text}</span>
            <button onClick={() => setBanner(null)} className="text-current/70 hover:text-current"><XIcon size={14} /></button>
          </div>
        )}

        {leads.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-8 text-center">
            <p className="text-sm text-gray-600 mb-2">まだリードが登録されていません。</p>
            <p className="text-xs text-gray-500">
              CRM やスプレッドシートから書き出した CSV を「CSV取り込み」から読み込むと、
              有効リード率・商談化率・CPO・CAC が自動で算出されます。
            </p>
          </div>
        ) : (
          <>
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {tiles.map((t) => (
                <div key={t.label} className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
                  <div className="text-[11px] text-gray-500">{t.label}</div>
                  <div className={clsx("text-2xl font-bold tabular-nums mt-0.5", t.cls)}>{t.value}</div>
                  {t.sub && <div className="text-[11px] text-gray-500 mt-0.5">{t.sub}</div>}
                </div>
              ))}
            </section>

            <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 sm:p-5 mb-6">
              <h2 className="font-semibold mb-1">獲得月コホート</h2>
              <p className="text-[11px] text-gray-500 mb-3">
                BtoBは検討期間が長いため、当月の広告費と当月の受注を割り算しても意味がありません。「いつ獲得したリードがどこまで進んだか」で見ます。
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="text-[11px] text-gray-500 border-b border-gray-200">
                      <th className="text-left font-normal py-2 pr-3">獲得月</th>
                      <th className="text-right font-normal py-2 px-3">広告費</th>
                      <th className="text-right font-normal py-2 px-3">リード</th>
                      <th className="text-right font-normal py-2 px-3">有効</th>
                      <th className="text-right font-normal py-2 px-3">商談</th>
                      <th className="text-right font-normal py-2 px-3">受注</th>
                      <th className="text-right font-normal py-2 px-3">CPO</th>
                      <th className="text-right font-normal py-2 pl-3">CAC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cohorts.map((c) => (
                      <tr key={c.month} className="border-b border-gray-100 last:border-0">
                        <td className="py-2.5 pr-3 text-gray-800">{c.month}</td>
                        <td className="text-right px-3 tabular-nums text-gray-800">{yen(c.costYen)}</td>
                        <td className="text-right px-3 tabular-nums text-gray-600">{num(c.leads)}</td>
                        <td className="text-right px-3 tabular-nums text-gray-600">{num(c.valid)}</td>
                        <td className="text-right px-3 tabular-nums text-gray-800">{num(c.meetings)}</td>
                        <td className="text-right px-3 tabular-nums text-gray-800">{num(c.wons)}</td>
                        <td className="text-right px-3 tabular-nums text-gray-800">{c.cpo ? yen(c.cpo) : "—"}</td>
                        <td className="text-right pl-3 tabular-nums text-gray-800">{c.cac ? yen(c.cac) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <h2 className="font-semibold">リード一覧</h2>
                <select
                  value={filter.validity}
                  onChange={(e) => setFilter({ ...filter, validity: e.target.value })}
                  className="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white"
                >
                  <option value="">有効判定: すべて</option>
                  <option value="valid">有効のみ</option>
                  <option value="invalid">無効のみ</option>
                  <option value="unknown">未判定</option>
                </select>
                <select
                  value={filter.stage}
                  onChange={(e) => setFilter({ ...filter, stage: e.target.value })}
                  className="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white"
                >
                  <option value="">段階: すべて</option>
                  {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <span className="text-[11px] text-gray-500 ml-auto">{shown.length}件表示</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="text-[11px] text-gray-500 border-b border-gray-200">
                      <th className="text-left font-normal py-2 pr-3">獲得日</th>
                      <th className="text-left font-normal py-2 px-3">会社 / 担当</th>
                      <th className="text-left font-normal py-2 px-3">メール</th>
                      <th className="text-left font-normal py-2 px-3">有効判定</th>
                      <th className="text-left font-normal py-2 px-3">段階</th>
                      <th className="text-right font-normal py-2 px-3">受注金額</th>
                      <th className="text-left font-normal py-2 pl-3">キャンペーン</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((l) => (
                      <tr key={l.id} className={clsx("border-b border-gray-100 last:border-0", busy === l.id && "opacity-50")}>
                        <td className="py-2.5 pr-3 text-gray-600 tabular-nums">{l.leadAt}</td>
                        <td className="px-3 max-w-[200px] truncate">
                          <span className="text-gray-800">{l.companyName || "（会社名なし）"}</span>
                          {l.personName && <span className="text-gray-500 text-xs"> / {l.personName}</span>}
                        </td>
                        <td className="px-3 max-w-[180px] truncate text-gray-600 text-xs">{l.email || "—"}</td>
                        <td className="px-3">
                          <select
                            value={l.validity}
                            disabled={busy !== null}
                            onChange={(e) => patch(l.id, { validity: e.target.value })}
                            className={clsx("text-xs border rounded-md px-1.5 py-0.5",
                              l.validity === "valid" ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                : l.validity === "invalid" ? "border-red-300 bg-red-50 text-red-700"
                                : "border-gray-300 bg-white text-gray-600")}
                          >
                            <option value="unknown">未判定</option>
                            <option value="valid">有効</option>
                            <option value="invalid">無効</option>
                          </select>
                          {l.validity === "invalid" && l.invalidReason && (
                            <span className="block text-[10px] text-gray-500 mt-0.5">{l.invalidReason}</span>
                          )}
                        </td>
                        <td className="px-3">
                          <select
                            value={l.stage}
                            disabled={busy !== null}
                            onChange={(e) => patch(l.id, { stage: e.target.value })}
                            className="text-xs border border-gray-300 rounded-md px-1.5 py-0.5 bg-white text-gray-700"
                          >
                            {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                          </select>
                          {l.lost && <span className="block text-[10px] text-red-600 mt-0.5">失注</span>}
                        </td>
                        <td className="text-right px-3 tabular-nums text-gray-800">
                          {l.dealAmountYen ? yen(l.dealAmountYen) : "—"}
                        </td>
                        <td className="pl-3 max-w-[160px] truncate text-gray-600 text-xs">
                          {l.campaignName || "—"}
                          {l.hasGclid && <span className="ml-1 text-[10px] text-sky-700" title="GCLIDあり（将来のオフラインCV戻しに使えます）">◆</span>}
                        </td>
                        <td className="pl-2">
                          <button onClick={() => remove(l.id)} disabled={busy !== null} className="text-gray-400 hover:text-red-600">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onDone={(msg) => { setShowImport(false); setBanner({ kind: "ok", text: msg }); router.refresh(); }}
        />
      )}
      {showRules && (
        <RulesModal
          rules={rules}
          onClose={() => setShowRules(false)}
          onDone={(msg) => { setShowRules(false); setBanner({ kind: "ok", text: msg }); router.refresh(); }}
        />
      )}
    </div>
  );
}
