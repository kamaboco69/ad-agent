import type { PlatformId } from "@/lib/platforms";
import type { AdProvider, ProviderConnection, SyncResult, TokenSet } from "./types";
import { ProviderError, lastDatesJst } from "./types";

// Meta Marketing API（Facebook / Instagram 共通）。
// platform=instagram のときは insights を publisher_platform で絞り込む。
// 必要権限: ads_read（読み取り）, ads_management（ステータス/予算変更）。

const GRAPH = "https://graph.facebook.com/v21.0";

function appId() {
  return process.env.META_ADS_APP_ID ?? "";
}
function appSecret() {
  return process.env.META_ADS_APP_SECRET ?? "";
}

async function graphGet<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${GRAPH}${path}?${qs}`, { cache: "no-store" });
  const json = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok || json.error) {
    throw new ProviderError(`Meta API エラー: ${json.error?.message ?? res.status}`);
  }
  return json;
}

async function graphPost(path: string, params: Record<string, string>, token: string): Promise<void> {
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${GRAPH}${path}`, { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as { error?: { message: string } };
  if (!res.ok || json.error) {
    throw new ProviderError(`Meta API エラー: ${json.error?.message ?? res.status}`);
  }
}

function requireToken(conn: ProviderConnection): string {
  if (!conn.accessToken) throw new ProviderError("Meta のアクセストークンがありません。再接続してください。");
  return conn.accessToken;
}

// JPY は Meta 上でも最小単位=円（オフセット1）。他通貨対応時は currency ごとの offset が必要。
const STATUS_MAP: Record<string, "active" | "paused" | "ended"> = {
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "ended",
  DELETED: "ended",
};

const PURCHASE_ACTIONS = new Set([
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
  "onsite_conversion.purchase",
  "lead",
  "offsite_conversion.fb_pixel_lead",
]);

interface InsightRow {
  campaign_id: string;
  date_start: string;
  impressions?: string;
  clicks?: string;
  spend?: string;
  publisher_platform?: string;
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
}

export function createMetaProvider(platform: PlatformId): AdProvider {
  const igOnly = platform === "instagram";

  return {
    platform,
    configured: () => !!(appId() && appSecret()),

    authUrl(state, redirectUri) {
      const qs = new URLSearchParams({
        client_id: appId(),
        redirect_uri: redirectUri,
        state,
        scope: "ads_read,ads_management,business_management",
        response_type: "code",
      });
      return `https://www.facebook.com/v21.0/dialog/oauth?${qs}`;
    },

    async exchangeCode(code, redirectUri): Promise<TokenSet> {
      const qs = new URLSearchParams({
        client_id: appId(),
        client_secret: appSecret(),
        redirect_uri: redirectUri,
        code,
      });
      const res = await fetch(`${GRAPH}/oauth/access_token?${qs}`, { cache: "no-store" });
      const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: { message: string } };
      if (!json.access_token) throw new ProviderError(`Meta トークン交換に失敗: ${json.error?.message ?? "unknown"}`);

      // 長期トークン（約60日）へ交換
      const llQs = new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId(),
        client_secret: appSecret(),
        fb_exchange_token: json.access_token,
      });
      const llRes = await fetch(`${GRAPH}/oauth/access_token?${llQs}`, { cache: "no-store" });
      const ll = (await llRes.json()) as { access_token?: string; expires_in?: number };
      const token = ll.access_token ?? json.access_token;
      const expiresIn = ll.expires_in ?? json.expires_in;

      // 最初の広告アカウントを既定の接続先にする
      const accounts = await graphGet<{ data?: { id: string; name: string; account_id: string }[] }>(
        "/me/adaccounts",
        { fields: "name,account_id", limit: "10" },
        token
      );
      const first = accounts.data?.[0];
      if (!first) throw new ProviderError("このユーザーがアクセスできる広告アカウントが見つかりません");

      return {
        accessToken: token,
        expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
        externalAccountId: first.id, // act_XXXX 形式
        accountName: `${first.name}（${first.account_id}）`,
      };
    },

    async sync(conn, days): Promise<SyncResult> {
      const token = requireToken(conn);
      const actId = conn.externalAccountId;
      if (!actId) throw new ProviderError("広告アカウントIDが未設定です");

      const campaignsRes = await graphGet<{
        data?: { id: string; name: string; status: string; objective?: string; daily_budget?: string; start_time?: string; stop_time?: string }[];
      }>(`/${actId}/campaigns`, { fields: "id,name,status,objective,daily_budget,start_time,stop_time", limit: "200" }, token);

      const dates = lastDatesJst(days);
      const params: Record<string, string> = {
        level: "campaign",
        time_increment: "1",
        time_range: JSON.stringify({ since: dates[0], until: dates[dates.length - 1] }),
        fields: "campaign_id,impressions,clicks,spend,actions,action_values",
        limit: "5000",
      };
      if (igOnly) params.breakdowns = "publisher_platform";
      const insights = await graphGet<{ data?: InsightRow[] }>(`/${actId}/insights`, params, token);

      const rows = (insights.data ?? []).filter((r) => !igOnly || r.publisher_platform === "instagram");

      return {
        campaigns: (campaignsRes.data ?? []).map((c) => ({
          externalId: c.id,
          name: c.name,
          status: STATUS_MAP[c.status] ?? "paused",
          objective: c.objective?.toLowerCase(),
          dailyBudgetYen: c.daily_budget ? Number(c.daily_budget) : undefined,
          startDate: c.start_time ? new Date(c.start_time) : undefined,
          endDate: c.stop_time ? new Date(c.stop_time) : undefined,
        })),
        metrics: rows.map((r) => {
          const conv = (r.actions ?? [])
            .filter((a) => PURCHASE_ACTIONS.has(a.action_type))
            .reduce((s, a) => s + Number(a.value), 0);
          const convValue = (r.action_values ?? [])
            .filter((a) => PURCHASE_ACTIONS.has(a.action_type))
            .reduce((s, a) => s + Number(a.value), 0);
          return {
            campaignExternalId: r.campaign_id,
            date: r.date_start,
            impressions: Number(r.impressions ?? 0),
            clicks: Number(r.clicks ?? 0),
            costYen: Math.round(Number(r.spend ?? 0)),
            conversions: conv,
            conversionValueYen: Math.round(convValue),
          };
        }),
      };
    },

    async setCampaignStatus(conn, externalId, status) {
      const token = requireToken(conn);
      await graphPost(`/${externalId}`, { status: status === "active" ? "ACTIVE" : "PAUSED" }, token);
    },

    async setDailyBudget(conn, externalId, yen) {
      const token = requireToken(conn);
      await graphPost(`/${externalId}`, { daily_budget: String(yen) }, token);
    },
  };
}
