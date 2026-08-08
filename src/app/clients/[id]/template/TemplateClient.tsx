"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Mail, Settings2, X as XIcon } from "lucide-react";
import clsx from "clsx";

export interface TemplateForm {
  clientName: string;
  agencyName: string;
  logoUrl: string;
  accentColor: string;
  greeting: string;
  showSummary: boolean;
  showPlatforms: boolean;
  showCampaigns: boolean;
  showInsight: boolean;
  showActions: boolean;
  showLeads: boolean;
  autoSend: boolean;
  sendDay: number;
  recipients: string;
}

const SECTIONS: { key: keyof TemplateForm; label: string; hint: string }[] = [
  { key: "showSummary", label: "全体サマリー", hint: "費用・CV・CPA・ROASのKPI" },
  { key: "showPlatforms", label: "媒体別パフォーマンス", hint: "媒体ごとの実績表" },
  { key: "showCampaigns", label: "キャンペーン別", hint: "費用上位のキャンペーン" },
  { key: "showInsight", label: "分析と改善提案", hint: "AIが生成した分析レポート" },
  { key: "showActions", label: "実施した施策", hint: "変更ログと効果検証" },
  { key: "showLeads", label: "リードのファネル", hint: "BtoBの商談化率・CPO・CAC" },
];

export function TemplateClient({
  connectionId, accountName, initial, mailReady, lastSentAt,
}: {
  connectionId: string;
  accountName: string;
  initial: TemplateForm;
  mailReady: boolean;
  lastSentAt: string | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const set = <K extends keyof TemplateForm>(k: K, v: TemplateForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (alsoSend = false) => {
    setBusy(alsoSend ? "send" : "save");
    setBanner(null);
    try {
      const res = await fetch(`/api/connections/${connectionId}/template${alsoSend ? "?send=1" : ""}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; sent?: { to: string[] } };
      if (!res.ok) {
        setBanner({ kind: "error", text: j.error ?? "保存に失敗しました" });
        return;
      }
      setBanner({
        kind: "ok",
        text: alsoSend ? `保存し、${j.sent?.to.join("、") ?? ""} へテスト送信しました` : "保存しました",
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Settings2 size={18} className="text-sky-700" />
            レポート設定
          </h1>
          <span className="text-sm text-gray-600">{accountName}</span>
          <a href="/clients" className="ml-auto text-sm text-gray-600 hover:text-gray-900">← クライアント一覧</a>
        </div>
        <p className="text-xs text-gray-500 mb-6">
          ここで設定した体裁が Excel・PowerPoint・PDF レポートに反映されます。
        </p>

        {banner && (
          <div className={clsx("flex items-center gap-2 rounded-lg px-4 py-2.5 mb-4 text-sm",
            banner.kind === "ok" ? "bg-emerald-50 border border-emerald-300 text-emerald-700" : "bg-red-50 border border-red-300 text-red-700")}>
            {banner.kind === "error" && <AlertTriangle size={15} className="shrink-0" />}
            <span className="flex-1">{banner.text}</span>
            <button onClick={() => setBanner(null)}><XIcon size={14} /></button>
          </div>
        )}

        <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 mb-4">
          <h2 className="font-semibold mb-3">体裁</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs">
              <span className="block text-gray-700 mb-1">クライアント名（表紙の宛名）</span>
              <input value={form.clientName} onChange={(e) => set("clientName", e.target.value)}
                placeholder={accountName}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white" />
            </label>
            <label className="text-xs">
              <span className="block text-gray-700 mb-1">自社名（差出人）</span>
              <input value={form.agencyName} onChange={(e) => set("agencyName", e.target.value)}
                placeholder="株式会社◯◯"
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white" />
            </label>
            <label className="text-xs">
              <span className="block text-gray-700 mb-1">ロゴ画像のURL</span>
              <input value={form.logoUrl} onChange={(e) => set("logoUrl", e.target.value)}
                placeholder="https://example.com/logo.png"
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white" />
            </label>
            <label className="text-xs">
              <span className="block text-gray-700 mb-1">アクセントカラー</span>
              <div className="flex items-center gap-2">
                <input type="color" value={form.accentColor} onChange={(e) => set("accentColor", e.target.value)}
                  className="h-9 w-14 border border-gray-300 rounded-md bg-white" />
                <span className="text-sm text-gray-600 tabular-nums">{form.accentColor}</span>
              </div>
            </label>
          </div>
          <label className="text-xs block mt-3">
            <span className="block text-gray-700 mb-1">挨拶文（表紙下）</span>
            <textarea value={form.greeting} onChange={(e) => set("greeting", e.target.value)} rows={2}
              placeholder="平素より格別のご高配を賜り、厚く御礼申し上げます。"
              className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white" />
          </label>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 mb-4">
          <h2 className="font-semibold mb-1">掲載するセクション</h2>
          <p className="text-[11px] text-gray-500 mb-3">クライアントに見せたい項目だけを選べます。</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SECTIONS.map((s) => (
              <label key={s.key} className="flex items-start gap-2 text-sm cursor-pointer rounded-lg px-2 py-1.5 hover:bg-gray-50">
                <input type="checkbox" checked={form[s.key] as boolean}
                  onChange={(e) => set(s.key, e.target.checked as never)} className="accent-sky-600 mt-0.5" />
                <span>
                  <span className="text-gray-800">{s.label}</span>
                  <span className="block text-[10px] text-gray-500">{s.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 mb-4">
          <h2 className="font-semibold mb-1 flex items-center gap-2">
            <Mail size={15} className="text-sky-700" />
            自動配信
          </h2>
          <p className="text-[11px] text-gray-500 mb-3">
            毎月決まった日に、Excel と PowerPoint を添付してクライアントへ自動送付します。
            {lastSentAt && <span className="ml-1">前回送信: {lastSentAt}</span>}
          </p>

          {!mailReady && (
            <div className="flex items-start gap-2 rounded-lg px-3 py-2 mb-3 text-xs bg-amber-50 border border-amber-300 text-amber-800">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>
                メール送信の設定が未完了です。環境変数 <code>RESEND_API_KEY</code> と <code>REPORT_MAIL_FROM</code>（送信元アドレス）を設定すると有効になります。設定の保存は今でもできます。
              </span>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm cursor-pointer mb-3">
            <input type="checkbox" checked={form.autoSend} onChange={(e) => set("autoSend", e.target.checked)} className="accent-sky-600" />
            自動配信を有効にする
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-xs">
              <span className="block text-gray-700 mb-1">送信日（毎月）</span>
              <select value={form.sendDay} onChange={(e) => set("sendDay", Number(e.target.value))}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white">
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}日</option>)}
              </select>
            </label>
            <label className="text-xs sm:col-span-2">
              <span className="block text-gray-700 mb-1">宛先（カンマ区切りで複数可）</span>
              <input value={form.recipients} onChange={(e) => set("recipients", e.target.value)}
                placeholder="client@example.com, sub@example.com"
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white" />
            </label>
          </div>
        </section>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => save(false)} disabled={busy !== null}
            className="flex items-center gap-1.5 text-sm bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-gray-50 rounded-lg px-4 py-2">
            {busy === "save" ? <Loader2 size={14} className="animate-spin" /> : null}
            保存
          </button>
          <button onClick={() => save(true)} disabled={busy !== null || !mailReady || !form.recipients}
            title={!mailReady ? "メール送信の設定が必要です" : ""}
            className="flex items-center gap-1.5 text-sm border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-50 text-gray-700 rounded-lg px-4 py-2">
            {busy === "send" ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
            保存してテスト送信
          </button>
          <a href={`/api/connections/${connectionId}/export?format=xlsx`}
            className="text-sm border border-gray-300 bg-white hover:bg-gray-100 text-gray-700 rounded-lg px-4 py-2">
            Excelで確認
          </a>
          <a href={`/api/connections/${connectionId}/export?format=pptx`}
            className="text-sm border border-gray-300 bg-white hover:bg-gray-100 text-gray-700 rounded-lg px-4 py-2">
            PowerPointで確認
          </a>
        </div>
      </div>
    </div>
  );
}
