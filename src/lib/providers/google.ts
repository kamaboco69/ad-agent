import type { AdProvider, ProviderConnection, SelectableAccount, SyncResult, TokenSet } from "./types";
import { ProviderError, lastDatesJst } from "./types";

// Google Ads API（REST）。
// 必要: OAuth クライアント（GOOGLE_ADS_CLIENT_ID/SECRET）＋ 開発者トークン（GOOGLE_ADS_DEVELOPER_TOKEN, Basic access 以上）。
// アクセストークンは1時間で失効するため、毎回リフレッシュトークンから取得する。
// 注意: バージョンは約1年で廃止される（v18は2026-07時点で404 HTML を返した）。廃止されると
// 「Unexpected token '<' ... is not valid JSON」で全滅するため、エラー時はまずバージョン生存を疑う。

const ADS_API = "https://googleads.googleapis.com/v23";

function clientId() {
  return process.env.GOOGLE_ADS_CLIENT_ID ?? "";
}
function clientSecret() {
  return process.env.GOOGLE_ADS_CLIENT_SECRET ?? "";
}
function developerToken() {
  return process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "";
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: refreshToken,
    }),
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!json.access_token) {
    throw new ProviderError(`Google トークン更新に失敗: ${json.error_description ?? res.status}。再接続してください。`);
  }
  return json.access_token;
}

async function freshToken(conn: ProviderConnection): Promise<string> {
  if (conn.refreshToken) return refreshAccessToken(conn.refreshToken);
  if (conn.accessToken) return conn.accessToken;
  throw new ProviderError("Google のトークンがありません。再接続してください。");
}

function adsHeaders(token: string, loginCustomerId?: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": developerToken(),
    "Content-Type": "application/json",
  };
  if (loginCustomerId) h["login-customer-id"] = loginCustomerId;
  return h;
}

interface SearchRow {
  campaign?: { id?: string; name?: string; status?: string; campaignBudget?: string };
  campaignBudget?: { amountMicros?: string };
  segments?: { date?: string };
  metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number; conversionsValue?: number };
  customer?: { id?: string; descriptiveName?: string; manager?: boolean };
  customerClient?: { id?: string; descriptiveName?: string; manager?: boolean; level?: string };
}

// 運用対象アカウント（path 用）と login-customer-id（MCC経由なら親マネージャー）を分けて指定する
async function gaqlSearch(
  token: string,
  customerId: string,
  query: string,
  loginCustomerId?: string
): Promise<SearchRow[]> {
  const res = await fetch(`${ADS_API}/customers/${customerId}/googleAds:search`, {
    method: "POST",
    headers: adsHeaders(token, loginCustomerId ?? customerId),
    body: JSON.stringify({ query, pageSize: 10000 }),
  });
  // 廃止バージョン等では HTML が返るため、JSONで読めない場合もステータスで説明する
  const json = (await res.json().catch(() => ({}))) as { results?: SearchRow[]; error?: { message?: string } };
  if (!res.ok) throw new ProviderError(`Google Ads API エラー: ${json.error?.message ?? `HTTP ${res.status}`}`);
  return json.results ?? [];
}

const STATUS_MAP: Record<string, "active" | "paused" | "ended"> = {
  ENABLED: "active",
  PAUSED: "paused",
  REMOVED: "ended",
};

function cid(conn: ProviderConnection): string {
  const id = conn.externalAccountId?.replace(/-/g, "");
  if (!id) throw new ProviderError("Google 広告のお客様IDが未設定です");
  return id;
}

// login-customer-id ヘッダ用: MCC経由なら親マネージャーID、直接アクセスは運用アカウント自身
function loginCid(conn: ProviderConnection): string {
  return (conn.loginCustomerId ?? conn.externalAccountId ?? "").replace(/-/g, "");
}

export function createGoogleProvider(): AdProvider {
  return {
    platform: "google",
    configured: () => !!(clientId() && clientSecret() && developerToken()),

    authUrl(state, redirectUri) {
      const qs = new URLSearchParams({
        client_id: clientId(),
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "https://www.googleapis.com/auth/adwords",
        access_type: "offline",
        prompt: "consent",
        state,
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${qs}`;
    },

    async exchangeCode(code, redirectUri): Promise<TokenSet> {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId(),
          client_secret: clientSecret(),
          redirect_uri: redirectUri,
          code,
        }),
      });
      const json = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error_description?: string;
      };
      if (!json.access_token) throw new ProviderError(`Google トークン交換に失敗: ${json.error_description ?? "unknown"}`);

      // アクセス可能なお客様アカウントの先頭を既定の接続先にする
      const listRes = await fetch(`${ADS_API}/customers:listAccessibleCustomers`, {
        headers: adsHeaders(json.access_token),
      });
      const list = (await listRes.json().catch(() => ({}))) as { resourceNames?: string[]; error?: { message?: string } };
      const first = list.resourceNames?.[0]?.replace("customers/", "");
      if (!first) {
        throw new ProviderError(
          `アクセス可能な Google 広告アカウントが見つかりません: ${list.error?.message ?? `HTTP ${listRes.status}`}`
        );
      }

      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
        externalAccountId: first,
        accountName: `Google 広告 ${first}`,
      };
    },

    // 接続ユーザーがアクセス可能な運用アカウントを列挙（MCC配下も展開）。UIのアカウント選択で使用。
    async listAccounts(conn): Promise<SelectableAccount[]> {
      const token = await freshToken(conn);
      const listRes = await fetch(`${ADS_API}/customers:listAccessibleCustomers`, {
        headers: adsHeaders(token),
      });
      const list = (await listRes.json().catch(() => ({}))) as { resourceNames?: string[]; error?: { message?: string } };
      if (!listRes.ok) {
        throw new ProviderError(`アカウント一覧の取得に失敗: ${list.error?.message ?? `HTTP ${listRes.status}`}`);
      }
      const accessible = (list.resourceNames ?? []).map((r) => r.replace("customers/", ""));

      const out: SelectableAccount[] = [];
      const seen = new Set<string>();
      const add = (a: SelectableAccount) => {
        if (a.id && !seen.has(a.id)) {
          seen.add(a.id);
          out.push(a);
        }
      };

      for (const acc of accessible) {
        try {
          const info = await gaqlSearch(
            token,
            acc,
            "SELECT customer.id, customer.descriptive_name, customer.manager FROM customer",
            acc
          );
          const c = info[0]?.customer;
          const name = c?.descriptiveName || `アカウント ${acc}`;
          if (c?.manager !== true) {
            add({ id: acc, loginCustomerId: null, name });
            continue;
          }
          // マネージャー(MCC)の場合は配下の運用アカウント（非マネージャー）を列挙
          const clients = await gaqlSearch(
            token,
            acc,
            "SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.level FROM customer_client WHERE customer_client.level <= 1",
            acc
          );
          for (const row of clients) {
            const cc = row.customerClient;
            if (!cc?.id || cc.manager === true) continue;
            add({ id: String(cc.id), loginCustomerId: acc, name: cc.descriptiveName || `アカウント ${cc.id}` });
          }
        } catch {
          // 個別アカウントの取得に失敗しても一覧全体は返す（フォールバックで生IDを追加）
          add({ id: acc, loginCustomerId: null, name: `アカウント ${acc}` });
        }
      }
      return out;
    },

    async sync(conn, days): Promise<SyncResult> {
      const token = await freshToken(conn);
      const customerId = cid(conn);
      const login = loginCid(conn);
      const dates = lastDatesJst(days);

      const campaignRows = await gaqlSearch(
        token,
        customerId,
        `SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros
         FROM campaign WHERE campaign.status != 'REMOVED'`,
        login
      );
      const metricRows = await gaqlSearch(
        token,
        customerId,
        `SELECT campaign.id, segments.date, metrics.impressions, metrics.clicks,
                metrics.cost_micros, metrics.conversions, metrics.conversions_value
         FROM campaign
         WHERE segments.date BETWEEN '${dates[0]}' AND '${dates[dates.length - 1]}'`,
        login
      );

      return {
        campaigns: campaignRows.map((r) => ({
          externalId: String(r.campaign?.id ?? ""),
          name: r.campaign?.name ?? "(不明)",
          status: STATUS_MAP[r.campaign?.status ?? ""] ?? "paused",
          dailyBudgetYen: r.campaignBudget?.amountMicros
            ? Math.round(Number(r.campaignBudget.amountMicros) / 1_000_000)
            : undefined,
        })),
        metrics: metricRows.map((r) => ({
          campaignExternalId: String(r.campaign?.id ?? ""),
          date: r.segments?.date ?? dates[0],
          impressions: Number(r.metrics?.impressions ?? 0),
          clicks: Number(r.metrics?.clicks ?? 0),
          costYen: Math.round(Number(r.metrics?.costMicros ?? 0) / 1_000_000),
          conversions: Number(r.metrics?.conversions ?? 0),
          conversionValueYen: Math.round(Number(r.metrics?.conversionsValue ?? 0)),
        })),
      };
    },

    async setCampaignStatus(conn, externalId, status) {
      const token = await freshToken(conn);
      const customerId = cid(conn);
      const res = await fetch(`${ADS_API}/customers/${customerId}/campaigns:mutate`, {
        method: "POST",
        headers: adsHeaders(token, loginCid(conn)),
        body: JSON.stringify({
          operations: [
            {
              update: {
                resourceName: `customers/${customerId}/campaigns/${externalId}`,
                status: status === "active" ? "ENABLED" : "PAUSED",
              },
              updateMask: "status",
            },
          ],
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new ProviderError(`Google キャンペーン更新に失敗: ${json.error?.message ?? res.status}`);
      }
    },

    async setDailyBudget(conn, externalId, yen) {
      const token = await freshToken(conn);
      const customerId = cid(conn);
      const login = loginCid(conn);
      // キャンペーンに紐づく予算リソースを特定してから金額を更新する
      const rows = await gaqlSearch(
        token,
        customerId,
        `SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = ${Number(externalId)}`,
        login
      );
      const budgetResource = rows[0]?.campaign?.campaignBudget;
      if (!budgetResource) throw new ProviderError("キャンペーン予算リソースが見つかりません");

      const res = await fetch(`${ADS_API}/customers/${customerId}/campaignBudgets:mutate`, {
        method: "POST",
        headers: adsHeaders(token, login),
        body: JSON.stringify({
          operations: [
            {
              update: { resourceName: budgetResource, amountMicros: String(yen * 1_000_000) },
              updateMask: "amount_micros",
            },
          ],
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new ProviderError(`Google 予算更新に失敗: ${json.error?.message ?? res.status}`);
      }
    },
  };
}
