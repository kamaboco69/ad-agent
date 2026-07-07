import type { AdProvider, TokenSet } from "./types";
import { ProviderError } from "./types";

// Yahoo!広告 API。
// OAuth（Yahoo! JAPAN ビジネスID）までは実装済み。
// レポート取得は ReportDefinitionService の非同期ジョブ（作成→ポーリング→CSVダウンロード）で、
// API 利用申請の承認（代理店/ツールベンダー審査）が下りてから実装する。
// それまでは Yahoo! はデモ接続を利用する想定。

const OAUTH_BASE = "https://biz-oauth.yahoo.co.jp/oauth/v1";

function clientId() {
  return process.env.YAHOO_ADS_CLIENT_ID ?? "";
}
function clientSecret() {
  return process.env.YAHOO_ADS_CLIENT_SECRET ?? "";
}

const NOT_READY =
  "Yahoo!広告の実API同期は API 利用申請の承認後に対応予定です（レポートは非同期ジョブAPIのため）。それまではデモ接続をご利用ください。";

export function createYahooProvider(): AdProvider {
  return {
    platform: "yahoo",
    configured: () => !!(clientId() && clientSecret()),

    authUrl(state, redirectUri) {
      const qs = new URLSearchParams({
        response_type: "code",
        client_id: clientId(),
        redirect_uri: redirectUri,
        scope: "yahooads",
        state,
      });
      return `${OAUTH_BASE}/authorize?${qs}`;
    },

    async exchangeCode(code, redirectUri): Promise<TokenSet> {
      const qs = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId(),
        client_secret: clientSecret(),
        redirect_uri: redirectUri,
        code,
      });
      const res = await fetch(`${OAUTH_BASE}/token?${qs}`, { cache: "no-store" });
      const json = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
      };
      if (!json.access_token) throw new ProviderError(`Yahoo! トークン交換に失敗: ${json.error ?? res.status}`);
      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
        accountName: "Yahoo!広告アカウント",
      };
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
