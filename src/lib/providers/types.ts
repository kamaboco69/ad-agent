import type { PlatformId } from "@/lib/platforms";

// プロバイダに渡す接続情報（トークンは復号済み）
export interface ProviderConnection {
  id: string;
  platform: PlatformId;
  externalAccountId: string | null;
  // Google Ads: マネージャー(MCC)経由アクセス時の login-customer-id。直接アクセスは null
  loginCustomerId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
}

// 実API接続で選択可能なアカウント（Google Ads の複数アカウント/MCC配下から選ぶ）
export interface SelectableAccount {
  id: string; // 運用対象アカウントID（Google: customer_id）
  loginCustomerId: string | null; // MCC経由なら親マネージャーID、直接アクセスは null
  name: string; // 表示名
}

export interface ProviderCampaign {
  externalId: string;
  name: string;
  status: "active" | "paused" | "ended";
  objective?: string;
  dailyBudgetYen?: number;
  startDate?: Date;
  endDate?: Date;
}

// 日次実績（date は JST の YYYY-MM-DD）
export interface ProviderDailyMetric {
  campaignExternalId: string;
  date: string;
  impressions: number;
  clicks: number;
  costYen: number;
  conversions: number;
  conversionValueYen: number;
}

export interface SyncResult {
  campaigns: ProviderCampaign[];
  metrics: ProviderDailyMetric[];
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string;
  // トークン取得後にアカウント一覧から解決した接続先（Googleは最初の非マネージャーを既定にする）
  externalAccountId?: string;
  accountName?: string;
  loginCustomerId?: string | null; // MCC経由で接続する場合の親マネージャーID
}

// 検索語句レポートの1行（キャンペーン×語句で集計済み）
export interface SearchTermRow {
  campaignExternalId: string;
  campaignName: string;
  term: string;
  impressions: number;
  clicks: number;
  costYen: number;
  conversions: number;
  conversionValueYen: number;
}

// コンバージョン計測のヘルスチェック結果
export interface ConversionHealth {
  trackingStatus: string; // 例: CONVERSION_TRACKING_MANAGED_BY_SELF / NOT_CONVERSION_TRACKED
  actions: Array<{
    name: string;
    category: string;
    type: string;
    primary: boolean;
    countingType: string;
    hasValue: boolean;
  }>;
}

// アカウントの変更履歴（学習期間ガードの判定用）
export interface ChangeEventRow {
  at: string; // 変更日時
  resourceType: string;
  operation: string;
  fields: string;
}

// 広告媒体アダプタの共通インターフェース。
// 実装は「実APIの資格情報が env に揃っている場合のみ」有効（configured()）。
// 未対応の操作は ProviderError を throw する。
export interface AdProvider {
  platform: PlatformId;
  configured(): boolean;
  authUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<TokenSet>;
  // 接続後に選択可能なアカウント一覧を返す（対応する媒体のみ実装。Google Ads は複数アカウント/MCC配下を列挙）
  listAccounts?(conn: ProviderConnection): Promise<SelectableAccount[]>;
  sync(conn: ProviderConnection, days: number): Promise<SyncResult>;
  setCampaignStatus(conn: ProviderConnection, externalId: string, status: "active" | "paused"): Promise<void>;
  setDailyBudget(conn: ProviderConnection, externalId: string, yen: number): Promise<void>;
  // ── 運用改善（対応する媒体のみ実装。現状 Google Ads のみ） ──
  listSearchTerms?(conn: ProviderConnection, days: number): Promise<SearchTermRow[]>;
  addNegativeKeyword?(
    conn: ProviderConnection,
    campaignExternalId: string,
    term: string,
    matchType: "EXACT" | "PHRASE"
  ): Promise<void>;
  // 語句の昇格: 完全一致キーワードとして正式登録（SMARTはキーワードテーマ）
  addKeyword?(conn: ProviderConnection, campaignExternalId: string, term: string): Promise<void>;
  conversionHealth?(conn: ProviderConnection): Promise<ConversionHealth>;
  recentChanges?(conn: ProviderConnection, days: number): Promise<ChangeEventRow[]>;
}

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

// 直近 days 日（昨日まで）の JST 日付リストを返す
export function lastDatesJst(days: number): string[] {
  const out: string[] = [];
  const now = new Date(Date.now() + 9 * 3600_000); // JST
  for (let i = days; i >= 1; i--) {
    const d = new Date(now.getTime() - i * 86400_000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
