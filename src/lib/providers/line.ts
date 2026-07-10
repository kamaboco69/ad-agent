import type { AdProvider } from "./types";
import { ProviderError } from "./types";

// LINE Ads API。
// アクセスキー/シークレットキーによる JWS 署名方式（OAuth リダイレクトなし）で、
// API 利用申請の承認も前提になるため、実API接続は承認後に実装する。
// それまでは LINE はデモ接続を利用する想定。

const NOT_READY =
  "LINE 広告の実API接続は API 利用申請の承認後に対応予定です（キー署名方式）。それまではデモ接続をご利用ください。";

export function createLineProvider(): AdProvider {
  return {
    platform: "line",
    configured: () => false, // 承認・実装が済むまで実API接続は無効
    authUrl() {
      throw new ProviderError(NOT_READY);
    },
    async exchangeCode() {
      throw new ProviderError(NOT_READY);
    },
    async sync() {
      throw new ProviderError(NOT_READY);
    },
    async setCampaignStatus() {
      throw new ProviderError(NOT_READY);
    },
    async setDailyBudget() {
      throw new ProviderError(NOT_READY);
    },
  };
}
