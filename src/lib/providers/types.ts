import type { PlatformId } from "@/lib/platforms";

// プロバイダに渡す接続情報（トークンは復号済み）
export interface ProviderConnection {
  id: string;
  platform: PlatformId;
  externalAccountId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
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
  // トークン取得後にアカウント一覧から解決した接続先（先頭アカウントを既定にする）
  externalAccountId?: string;
  accountName?: string;
}

// 広告媒体アダプタの共通インターフェース。
// 実装は「実APIの資格情報が env に揃っている場合のみ」有効（configured()）。
// 未対応の操作は ProviderError を throw する。
export interface AdProvider {
  platform: PlatformId;
  configured(): boolean;
  authUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<TokenSet>;
  sync(conn: ProviderConnection, days: number): Promise<SyncResult>;
  setCampaignStatus(conn: ProviderConnection, externalId: string, status: "active" | "paused"): Promise<void>;
  setDailyBudget(conn: ProviderConnection, externalId: string, yen: number): Promise<void>;
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
