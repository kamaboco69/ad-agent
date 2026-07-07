import type { AdProvider } from "./types";
import { ProviderError } from "./types";

// X Ads API。
// OAuth 1.0a（リクエストトークン→署名付きリクエスト）が必要で、Ads API アクセス申請の
// 承認も前提になるため、実API接続は承認後に実装する。それまでは X はデモ接続を利用する想定。

const NOT_READY =
  "X 広告の実API接続は Ads API アクセス申請の承認後に対応予定です（OAuth 1.0a）。それまではデモ接続をご利用ください。";

export function createXProvider(): AdProvider {
  return {
    platform: "x",
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
