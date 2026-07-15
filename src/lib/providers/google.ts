import type {
  AdProvider,
  ChangeEventRow,
  ConversionHealth,
  ProviderConnection,
  SearchTermRow,
  SelectableAccount,
  SyncResult,
  TokenSet,
} from "./types";
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
  customer?: {
    id?: string;
    descriptiveName?: string;
    manager?: boolean;
    conversionTrackingSetting?: { conversionTrackingStatus?: string };
  };
  customerClient?: { id?: string; descriptiveName?: string; manager?: boolean; level?: string };
  searchTermView?: { searchTerm?: string };
  conversionAction?: {
    name?: string;
    category?: string;
    type?: string;
    status?: string;
    primaryForGoal?: boolean;
    countingType?: string;
    valueSettings?: { defaultValue?: number };
  };
  changeEvent?: {
    changeDateTime?: string;
    changeResourceType?: string;
    resourceChangeOperation?: string;
    changedFields?: string;
  };
}

// エラー応答から GoogleAdsFailure の詳細メッセージを取り出す（無ければ汎用 message）
interface AdsErrorBody {
  error?: {
    message?: string;
    details?: Array<{ errors?: Array<{ message?: string }> }>;
  };
}
function adsErrorMessage(json: AdsErrorBody, status: number): string {
  const detail = json.error?.details?.flatMap((d) => d.errors ?? []).map((e) => e.message).filter(Boolean);
  if (detail && detail.length > 0) return detail.join(" / ");
  return json.error?.message ?? `HTTP ${status}`;
}

// 運用対象アカウント（path 用）と login-customer-id（MCC経由なら親マネージャー）を分けて指定する
// 注意: v17以降 pageSize は廃止（固定1万件/ページ）。送ると INVALID_ARGUMENT になる。
async function gaqlSearch(
  token: string,
  customerId: string,
  query: string,
  loginCustomerId?: string
): Promise<SearchRow[]> {
  const res = await fetch(`${ADS_API}/customers/${customerId}/googleAds:search`, {
    method: "POST",
    headers: adsHeaders(token, loginCustomerId ?? customerId),
    body: JSON.stringify({ query }),
  });
  // 廃止バージョン等では HTML が返るため、JSONで読めない場合もステータスで説明する
  const json = (await res.json().catch(() => ({}))) as { results?: SearchRow[] } & AdsErrorBody;
  if (!res.ok) throw new ProviderError(`Google Ads API エラー: ${adsErrorMessage(json, res.status)}`);
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

// アクセス可能なアカウントを列挙し、MCC は配下の運用アカウント（非マネージャー）に展開する。
// 返り値の先頭が「接続既定」として使われるため、運用アカウントのみを追加する（フォールバック除く）。
async function enumerateAccounts(token: string): Promise<SelectableAccount[]> {
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

      // 接続先の既定は「最初の運用（非マネージャー）アカウント」。
      // MCC を既定にすると実績クエリが必ず失敗するため、列挙して運用アカウントを優先する。
      let picked: SelectableAccount | null = null;
      try {
        const accounts = await enumerateAccounts(json.access_token);
        picked = accounts[0] ?? null;
      } catch {
        // 列挙に失敗しても接続自体は成立させる（下のフォールバックへ）
      }
      if (!picked) {
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
        picked = { id: first, loginCustomerId: null, name: `Google 広告 ${first}` };
      }

      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
        externalAccountId: picked.id,
        accountName: picked.name,
        loginCustomerId: picked.loginCustomerId,
      };
    },

    // 接続ユーザーがアクセス可能な運用アカウントを列挙（MCC配下も展開）。UIのアカウント選択で使用。
    async listAccounts(conn): Promise<SelectableAccount[]> {
      const token = await freshToken(conn);
      return enumerateAccounts(token);
    },

    // 検索語句レポート（検索キャンペーン。キャンペーン×語句で集計）。消化額の大きい順に最大500行。
    async listSearchTerms(conn, days): Promise<SearchTermRow[]> {
      const token = await freshToken(conn);
      const customerId = cid(conn);
      const dates = lastDatesJst(days);
      const rows = await gaqlSearch(
        token,
        customerId,
        `SELECT search_term_view.search_term, campaign.id, campaign.name,
                metrics.impressions, metrics.clicks, metrics.cost_micros,
                metrics.conversions, metrics.conversions_value
         FROM search_term_view
         WHERE segments.date BETWEEN '${dates[0]}' AND '${dates[dates.length - 1]}'
         ORDER BY metrics.cost_micros DESC
         LIMIT 500`,
        loginCid(conn)
      );
      // search_term_view は広告グループ粒度なので、キャンペーン×語句で集計し直す
      const agg = new Map<string, SearchTermRow>();
      for (const r of rows) {
        const term = r.searchTermView?.searchTerm;
        const campaignId = r.campaign?.id;
        if (!term || !campaignId) continue;
        const key = `${campaignId} ${term}`;
        const cur = agg.get(key) ?? {
          campaignExternalId: String(campaignId),
          campaignName: r.campaign?.name ?? "(不明)",
          term,
          impressions: 0,
          clicks: 0,
          costYen: 0,
          conversions: 0,
          conversionValueYen: 0,
        };
        cur.impressions += Number(r.metrics?.impressions ?? 0);
        cur.clicks += Number(r.metrics?.clicks ?? 0);
        cur.costYen += Math.round(Number(r.metrics?.costMicros ?? 0) / 1_000_000);
        cur.conversions += Number(r.metrics?.conversions ?? 0);
        cur.conversionValueYen += Math.round(Number(r.metrics?.conversionsValue ?? 0));
        agg.set(key, cur);
      }
      return [...agg.values()].sort((a, b) => b.costYen - a.costYen);
    },

    // キャンペーン単位の除外キーワードを追加
    async addNegativeKeyword(conn, campaignExternalId, term, matchType): Promise<void> {
      const token = await freshToken(conn);
      const customerId = cid(conn);
      const res = await fetch(`${ADS_API}/customers/${customerId}/campaignCriteria:mutate`, {
        method: "POST",
        headers: adsHeaders(token, loginCid(conn)),
        body: JSON.stringify({
          operations: [
            {
              create: {
                campaign: `customers/${customerId}/campaigns/${campaignExternalId}`,
                negative: true,
                keyword: { text: term, matchType },
              },
            },
          ],
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as AdsErrorBody;
        throw new ProviderError(`除外キーワード追加に失敗: ${adsErrorMessage(json, res.status)}`);
      }
    },

    // コンバージョン計測のヘルスチェック（トラッキング状態＋有効なCVアクション一覧）
    async conversionHealth(conn): Promise<ConversionHealth> {
      const token = await freshToken(conn);
      const customerId = cid(conn);
      const login = loginCid(conn);
      const cust = await gaqlSearch(
        token,
        customerId,
        "SELECT customer.conversion_tracking_setting.conversion_tracking_status FROM customer",
        login
      );
      const actions = await gaqlSearch(
        token,
        customerId,
        `SELECT conversion_action.name, conversion_action.category, conversion_action.type,
                conversion_action.status, conversion_action.primary_for_goal,
                conversion_action.counting_type, conversion_action.value_settings.default_value
         FROM conversion_action WHERE conversion_action.status = 'ENABLED'`,
        login
      );
      return {
        trackingStatus: cust[0]?.customer?.conversionTrackingSetting?.conversionTrackingStatus ?? "UNKNOWN",
        actions: actions.map((r) => ({
          name: r.conversionAction?.name ?? "(不明)",
          category: r.conversionAction?.category ?? "",
          type: r.conversionAction?.type ?? "",
          primary: r.conversionAction?.primaryForGoal === true,
          countingType: r.conversionAction?.countingType ?? "",
          hasValue: (r.conversionAction?.valueSettings?.defaultValue ?? 0) > 0,
        })),
      };
    },

    // 直近の変更履歴（学習期間ガードの判定用）。change_event は日付範囲と LIMIT が必須。
    async recentChanges(conn, days): Promise<ChangeEventRow[]> {
      const token = await freshToken(conn);
      const customerId = cid(conn);
      const dates = lastDatesJst(Math.min(days, 28));
      const rows = await gaqlSearch(
        token,
        customerId,
        `SELECT change_event.change_date_time, change_event.change_resource_type,
                change_event.resource_change_operation, change_event.changed_fields
         FROM change_event
         WHERE change_event.change_date_time >= '${dates[0]} 00:00:00'
           AND change_event.change_date_time <= '${dates[dates.length - 1]} 23:59:59'
         ORDER BY change_event.change_date_time DESC
         LIMIT 50`,
        loginCid(conn)
      );
      return rows
        .filter((r) => r.changeEvent?.changeDateTime)
        .map((r) => ({
          at: r.changeEvent!.changeDateTime!,
          resourceType: r.changeEvent?.changeResourceType ?? "",
          operation: r.changeEvent?.resourceChangeOperation ?? "",
          fields: r.changeEvent?.changedFields ?? "",
        }));
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
        const json = (await res.json().catch(() => ({}))) as AdsErrorBody;
        throw new ProviderError(`Google キャンペーン更新に失敗: ${adsErrorMessage(json, res.status)}`);
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
        const json = (await res.json().catch(() => ({}))) as AdsErrorBody;
        throw new ProviderError(`Google 予算更新に失敗: ${adsErrorMessage(json, res.status)}`);
      }
    },
  };
}
