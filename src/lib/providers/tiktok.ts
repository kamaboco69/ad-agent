import type { AdProvider, ProviderConnection, SyncResult, TokenSet } from "./types";
import { ProviderError, lastDatesJst } from "./types";

// TikTok Business API（v1.3）。
// 必要: TikTok for Business 開発者アプリ（TIKTOK_ADS_APP_ID / TIKTOK_ADS_APP_SECRET）。

const API = "https://business-api.tiktok.com/open_api/v1.3";

function appId() {
  return process.env.TIKTOK_ADS_APP_ID ?? "";
}
function appSecret() {
  return process.env.TIKTOK_ADS_APP_SECRET ?? "";
}

interface TtResponse<T> {
  code: number;
  message: string;
  data?: T;
}

async function ttGet<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${API}${path}?${qs}`, {
    headers: { "Access-Token": token },
    cache: "no-store",
  });
  const json = (await res.json()) as TtResponse<T>;
  if (json.code !== 0 || !json.data) throw new ProviderError(`TikTok API エラー: ${json.message}`);
  return json.data;
}

async function ttPost<T>(path: string, body: unknown, token: string): Promise<T | undefined> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as TtResponse<T>;
  if (json.code !== 0) throw new ProviderError(`TikTok API エラー: ${json.message}`);
  return json.data;
}

function requireToken(conn: ProviderConnection): string {
  if (!conn.accessToken) throw new ProviderError("TikTok のアクセストークンがありません。再接続してください。");
  return conn.accessToken;
}

function advertiserId(conn: ProviderConnection): string {
  if (!conn.externalAccountId) throw new ProviderError("TikTok の広告主IDが未設定です");
  return conn.externalAccountId;
}

const STATUS_MAP: Record<string, "active" | "paused" | "ended"> = {
  ENABLE: "active",
  DISABLE: "paused",
  DELETE: "ended",
};

export function createTiktokProvider(): AdProvider {
  return {
    platform: "tiktok",
    configured: () => !!(appId() && appSecret()),

    authUrl(state, redirectUri) {
      const qs = new URLSearchParams({ app_id: appId(), state, redirect_uri: redirectUri });
      return `https://business-api.tiktok.com/portal/auth?${qs}`;
    },

    async exchangeCode(code): Promise<TokenSet> {
      // TikTok は auth_code をボディで交換（redirect_uri は不要）。トークンは長期有効。
      const data = await (async () => {
        const res = await fetch(`${API}/oauth2/access_token/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ app_id: appId(), secret: appSecret(), auth_code: code }),
        });
        const json = (await res.json()) as TtResponse<{ access_token?: string; advertiser_ids?: string[] }>;
        if (json.code !== 0 || !json.data?.access_token) {
          throw new ProviderError(`TikTok トークン交換に失敗: ${json.message}`);
        }
        return json.data;
      })();

      const firstAdvertiser = data.advertiser_ids?.[0];
      if (!firstAdvertiser) throw new ProviderError("アクセス可能な TikTok 広告主アカウントが見つかりません");

      return {
        accessToken: data.access_token!,
        externalAccountId: String(firstAdvertiser),
        accountName: `TikTok 広告主 ${firstAdvertiser}`,
      };
    },

    async sync(conn, days): Promise<SyncResult> {
      const token = requireToken(conn);
      const advId = advertiserId(conn);
      const dates = lastDatesJst(days);

      const campaignData = await ttGet<{
        list?: { campaign_id: string; campaign_name: string; operation_status: string; objective_type?: string; budget?: number }[];
      }>("/campaign/get/", { advertiser_id: advId, page_size: "100" }, token);

      const reportData = await ttGet<{
        list?: {
          dimensions: { campaign_id: string; stat_time_day: string };
          metrics: { impressions?: string; clicks?: string; spend?: string; conversion?: string; total_purchase_value?: string };
        }[];
      }>(
        "/report/integrated/get/",
        {
          advertiser_id: advId,
          report_type: "BASIC",
          data_level: "AUCTION_CAMPAIGN",
          dimensions: JSON.stringify(["campaign_id", "stat_time_day"]),
          metrics: JSON.stringify(["impressions", "clicks", "spend", "conversion"]),
          start_date: dates[0],
          end_date: dates[dates.length - 1],
          page_size: "1000",
        },
        token
      );

      return {
        campaigns: (campaignData.list ?? []).map((c) => ({
          externalId: c.campaign_id,
          name: c.campaign_name,
          status: STATUS_MAP[c.operation_status] ?? "paused",
          objective: c.objective_type?.toLowerCase(),
          dailyBudgetYen: c.budget ? Math.round(c.budget) : undefined,
        })),
        metrics: (reportData.list ?? []).map((r) => ({
          campaignExternalId: r.dimensions.campaign_id,
          date: r.dimensions.stat_time_day.slice(0, 10),
          impressions: Number(r.metrics.impressions ?? 0),
          clicks: Number(r.metrics.clicks ?? 0),
          costYen: Math.round(Number(r.metrics.spend ?? 0)),
          conversions: Number(r.metrics.conversion ?? 0),
          conversionValueYen: Math.round(Number(r.metrics.total_purchase_value ?? 0)),
        })),
      };
    },

    async setCampaignStatus(conn, externalId, status) {
      const token = requireToken(conn);
      await ttPost(
        "/campaign/status/update/",
        {
          advertiser_id: advertiserId(conn),
          campaign_ids: [externalId],
          operation_status: status === "active" ? "ENABLE" : "DISABLE",
        },
        token
      );
    },

    async setDailyBudget(conn, externalId, yen) {
      const token = requireToken(conn);
      await ttPost(
        "/campaign/update/",
        {
          advertiser_id: advertiserId(conn),
          campaign_id: externalId,
          budget: yen,
        },
        token
      );
    },
  };
}
