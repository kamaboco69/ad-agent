import Papa from "papaparse";
import { prisma } from "@/lib/db";

// BtoBリード管理のロジック。
// 広告の集計データ（CV数）だけでは「安いリードを大量に取れているが商談にならない」状態を
// 検出できないため、リード個票のその後（有効判定→MQL→商談→受注）から
// CPO（商談単価）/ CAC（受注単価）を算出する。

// ── CSV の読み込み ───────────────────────────────────

// 日本の CRM / フォームツールは Shift_JIS 出力が多い。UTF-8 で読んで文字化けが
// 多ければ Shift_JIS で読み直す（BOM 付き UTF-8 はそのまま通る）。
export function decodeCsv(buf: Buffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buf);
  const replacements = (utf8.match(/�/g) ?? []).length;
  if (replacements > 0 && replacements / Math.max(1, utf8.length) > 0.001) {
    try {
      return new TextDecoder("shift_jis").decode(buf).replace(/^﻿/, "");
    } catch {
      // shift_jis 非対応環境ではそのまま UTF-8 の結果を使う
    }
  }
  return utf8.replace(/^﻿/, "");
}

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const rows = (result.data ?? []).filter((r) => Object.values(r).some((v) => (v ?? "").trim() !== ""));
  const headers = (result.meta?.fields ?? []).filter(Boolean);
  return { headers, rows };
}

// ── カラム推測 ──────────────────────────────────────

export interface ColumnMap {
  externalKey?: string;
  email?: string;
  companyName?: string;
  personName?: string;
  memo?: string;
  gclid?: string;
  leadAt?: string;
  stage?: string;
  dealAmount?: string;
  campaignExternalId?: string;
  campaignName?: string;
}

// ヘッダ名の候補。前方一致・部分一致で拾う（CRM の項目名は表記ゆれが大きい）
const CANDIDATES: Record<keyof ColumnMap, string[]> = {
  externalKey: ["id", "レコードid", "リードid", "顧客id", "管理番号", "no", "番号"],
  email: ["email", "e-mail", "mail", "メールアドレス", "メール", "eメール"],
  companyName: ["company", "会社名", "企業名", "法人名", "組織名", "屋号"],
  personName: ["name", "氏名", "名前", "お名前", "担当者", "担当者名", "ご担当者"],
  memo: ["問い合わせ内容", "お問い合わせ内容", "memo", "備考", "内容", "要望", "comment", "message", "相談"],
  gclid: ["gclid", "click id", "クリックid", "wbraid", "gbraid"],
  leadAt: ["問い合わせ日", "獲得日", "作成日", "登録日", "受付日", "日付", "date", "created"],
  stage: ["status", "ステータス", "進捗", "商談状況", "フェーズ", "段階", "stage"],
  dealAmount: ["amount", "金額", "受注金額", "契約金額", "売上", "deal"],
  campaignExternalId: ["campaign id", "キャンペーンid", "campaignid", "utm_id"],
  campaignName: ["campaign", "キャンペーン", "utm_campaign", "流入元", "媒体"],
};

const norm = (s: string) => s.toLowerCase().replace(/[\s_－ー・()（）]/g, "");

// 部分一致で他フィールドの列を奪わないよう、具体的な項目から先に確定させる
// （例: "問い合わせ日" を memo の "問い合わせ" に取られると獲得日が全て今日になる）
const MATCH_ORDER: (keyof ColumnMap)[] = [
  "email", "gclid", "leadAt", "dealAmount", "stage",
  "companyName", "personName", "memo", "campaignExternalId", "campaignName", "externalKey",
];

export function guessColumns(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const used = new Set<string>();
  for (const key of MATCH_ORDER) {
    let best: { header: string; score: number } | null = null;
    for (const h of headers) {
      if (used.has(h)) continue;
      const nh = norm(h);
      for (const cand of CANDIDATES[key]) {
        const nc = norm(cand);
        // 完全一致 > 前方一致 > 部分一致 の順で優先する
        const score = nh === nc ? 3 : nh.startsWith(nc) ? 2 : nh.includes(nc) ? 1 : 0;
        if (score > 0 && (!best || score > best.score)) best = { header: h, score };
      }
    }
    if (best) {
      map[key] = best.header;
      used.add(best.header);
    }
  }
  return map;
}

// ── 有効リードの自動判定 ─────────────────────────────

const FREE_EMAIL_DOMAINS = [
  "gmail.com", "yahoo.co.jp", "yahoo.com", "icloud.com", "me.com", "outlook.com", "outlook.jp",
  "hotmail.com", "hotmail.co.jp", "live.jp", "aol.com", "docomo.ne.jp", "ezweb.ne.jp",
  "au.com", "softbank.ne.jp", "i.softbank.jp", "nifty.com", "ocn.ne.jp", "excite.co.jp",
];

export interface LeadRules {
  freeEmailInvalid: boolean;
  requireCompany: boolean;
  blockedDomains: string | null;
  blockedKeywords: string | null;
}

export const DEFAULT_RULES: LeadRules = {
  freeEmailInvalid: true,
  requireCompany: false,
  blockedDomains: null,
  blockedKeywords: "求人\n採用\n営業\n取材\n提携\nセールス",
};

const lines = (v: string | null) =>
  (v ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export interface JudgeInput {
  email?: string | null;
  companyName?: string | null;
  memo?: string | null;
}

export function judgeValidity(lead: JudgeInput, rules: LeadRules): { validity: "valid" | "invalid"; reason?: string } {
  const email = (lead.email ?? "").trim().toLowerCase();
  const domain = email.includes("@") ? email.split("@").pop()! : "";
  const haystack = `${lead.companyName ?? ""} ${lead.memo ?? ""}`.toLowerCase();

  for (const d of lines(rules.blockedDomains)) {
    if (d && domain.endsWith(d)) return { validity: "invalid", reason: `除外ドメイン（${d}）` };
  }
  for (const k of lines(rules.blockedKeywords)) {
    if (k && haystack.includes(k)) return { validity: "invalid", reason: `NGワード（${k}）` };
  }
  if (rules.freeEmailInvalid && domain && FREE_EMAIL_DOMAINS.includes(domain)) {
    return { validity: "invalid", reason: `フリーメール（${domain}）` };
  }
  if (rules.requireCompany && !(lead.companyName ?? "").trim()) {
    return { validity: "invalid", reason: "会社名なし" };
  }
  return { validity: "valid" };
}

// ── CSV → Lead 取り込み ─────────────────────────────

// CSVのステータス表記を stage / lost に正規化する
export function parseStage(raw: string | undefined): { stage: string; lost: boolean } {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return { stage: "lead", lost: false };
  if (/失注|lost|見送り|不成立/.test(v)) return { stage: "meeting", lost: true };
  if (/受注|成約|won|クローズ|契約/.test(v)) return { stage: "won", lost: false };
  if (/商談|面談|アポ|meeting|opportunity|提案/.test(v)) return { stage: "meeting", lost: false };
  if (/mql|有望|ナーチャ|検討/.test(v)) return { stage: "mql", lost: false };
  return { stage: "lead", lost: false };
}

function parseDate(raw: string | undefined): Date | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  // 2026/08/06, 2026-08-06, 2026年8月6日 などを受ける
  const cleaned = v.replace(/年|月/g, "/").replace(/日/g, "").replace(/\./g, "/");
  const d = new Date(cleaned);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseAmount(raw: string | undefined): number | null {
  const v = (raw ?? "").replace(/[¥,，\s円]/g, "");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export async function importLeads(
  organizationId: string,
  rows: Record<string, string>[],
  map: ColumnMap
): Promise<ImportResult> {
  const ruleRow = await prisma.leadRuleSet.findUnique({ where: { organizationId } });
  const rules: LeadRules = ruleRow ?? DEFAULT_RULES;

  // キャンペーン解決用の索引（externalId / 名前 → 内部ID）
  const campaigns = await prisma.campaign.findMany({
    where: { organizationId },
    select: { id: true, externalId: true, name: true, connectionId: true },
  });
  const byExternal = new Map(campaigns.map((c) => [c.externalId, c]));
  const byName = new Map(campaigns.map((c) => [c.name.trim(), c]));

  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  const seenKeys = new Set<string>();

  for (const [i, row] of rows.entries()) {
    const pick = (k?: string) => (k ? (row[k] ?? "").trim() : "");
    const email = pick(map.email);
    const companyName = pick(map.companyName);
    const leadAt = parseDate(pick(map.leadAt)) ?? new Date();

    // 一意キー: CSVに明示があれば使い、なければ メール+日付 で合成する
    const rawKey = pick(map.externalKey);
    const externalKey = rawKey || (email ? `${email}|${leadAt.toISOString().slice(0, 10)}` : "");
    if (!externalKey) {
      result.skipped++;
      result.errors.push(`${i + 2}行目: 一意キー（ID列またはメール）が無いためスキップしました`);
      continue;
    }
    if (seenKeys.has(externalKey)) {
      result.skipped++;
      continue; // 同一CSV内の重複
    }
    seenKeys.add(externalKey);

    const campaignExternalId = pick(map.campaignExternalId) || null;
    const campaignNameRaw = pick(map.campaignName) || null;
    const matched =
      (campaignExternalId ? byExternal.get(campaignExternalId) : undefined) ??
      (campaignNameRaw ? byName.get(campaignNameRaw) : undefined);

    const memo = pick(map.memo) || null;
    const { stage, lost } = parseStage(pick(map.stage));
    const auto = judgeValidity({ email, companyName, memo }, rules);

    const base = {
      organizationId,
      connectionId: matched?.connectionId ?? null,
      campaignId: matched?.id ?? null,
      campaignExternalId,
      campaignNameRaw,
      email: email || null,
      companyName: companyName || null,
      personName: pick(map.personName) || null,
      memo,
      gclid: pick(map.gclid) || null,
      leadAt,
      stage,
      lost,
      dealAmountYen: parseAmount(pick(map.dealAmount)),
      meetingAt: stage === "meeting" || stage === "won" ? leadAt : null,
      wonAt: stage === "won" ? leadAt : null,
    };

    try {
      const existing = await prisma.lead.findUnique({
        where: { organizationId_externalKey: { organizationId, externalKey } },
        select: { id: true, overridden: true },
      });
      if (existing) {
        // 手動修正済みのリードは validity を上書きしない（人の判断を優先する）
        await prisma.lead.update({
          where: { id: existing.id },
          data: existing.overridden
            ? base
            : { ...base, validity: auto.validity, invalidReason: auto.reason ?? null },
        });
        result.updated++;
      } else {
        await prisma.lead.create({
          data: { ...base, externalKey, validity: auto.validity, invalidReason: auto.reason ?? null },
        });
        result.created++;
      }
    } catch (e) {
      result.skipped++;
      result.errors.push(`${i + 2}行目: ${e instanceof Error ? e.message : "取込に失敗しました"}`);
    }
  }
  return result;
}

// ── BtoB KPI ────────────────────────────────────────

export interface LeadLike {
  validity: string;
  stage: string;
  lost: boolean;
  dealAmountYen: number | null;
  leadAt: Date;
}

export interface LeadKpi {
  leads: number;
  valid: number;
  mql: number;
  meetings: number;
  wons: number;
  validRate: number; // 有効リード率
  meetingRate: number; // 商談化率（有効リードのうち）
  wonRate: number; // 受注率（商談のうち）
  dealTotalYen: number;
  costYen: number;
  cpl: number | null; // リード単価（＝管理画面のCPA）
  cpValidLead: number | null; // 有効リード単価
  cpo: number | null; // 商談単価
  cac: number | null; // 受注単価
  ltvCacRatio: number | null;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);
// 件数0、または広告費0（＝その媒体の費用が未同期）のときは単価を出さない
const perUnit = (cost: number, n: number) => (n > 0 && cost > 0 ? cost / n : null);

export function computeLeadKpi(leads: LeadLike[], costYen: number, avgLtvYen?: number | null): LeadKpi {
  const valid = leads.filter((l) => l.validity === "valid");
  const mql = leads.filter((l) => ["mql", "meeting", "won"].includes(l.stage));
  const meetings = leads.filter((l) => ["meeting", "won"].includes(l.stage));
  const wons = leads.filter((l) => l.stage === "won");
  const cac = perUnit(costYen, wons.length);
  return {
    leads: leads.length,
    valid: valid.length,
    mql: mql.length,
    meetings: meetings.length,
    wons: wons.length,
    validRate: ratio(valid.length, leads.length),
    meetingRate: ratio(meetings.length, valid.length),
    wonRate: ratio(wons.length, meetings.length),
    dealTotalYen: wons.reduce((a, l) => a + (l.dealAmountYen ?? 0), 0),
    costYen,
    cpl: perUnit(costYen, leads.length),
    cpValidLead: perUnit(costYen, valid.length),
    cpo: perUnit(costYen, meetings.length),
    cac,
    ltvCacRatio: avgLtvYen && cac ? avgLtvYen / cac : null,
  };
}

// ── 月次コホート ────────────────────────────────────
// BtoBは検討期間が3〜12ヶ月あるため、当月費用÷当月受注では意味をなさない。
// 「いつ獲得したリードが、その後どこまで進んだか」で追う。

export interface CohortRow {
  month: string; // YYYY-MM
  costYen: number;
  leads: number;
  valid: number;
  meetings: number;
  wons: number;
  cpo: number | null;
  cac: number | null;
}

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export function buildCohorts(leads: LeadLike[], costByMonth: Map<string, number>): CohortRow[] {
  const months = new Map<string, LeadLike[]>();
  for (const l of leads) {
    const k = monthKey(l.leadAt);
    months.set(k, [...(months.get(k) ?? []), l]);
  }
  for (const k of costByMonth.keys()) if (!months.has(k)) months.set(k, []);

  return [...months.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, ls]) => {
      const cost = costByMonth.get(month) ?? 0;
      const k = computeLeadKpi(ls, cost);
      return {
        month,
        costYen: cost,
        leads: k.leads,
        valid: k.valid,
        meetings: k.meetings,
        wons: k.wons,
        cpo: k.cpo,
        cac: k.cac,
      };
    });
}
