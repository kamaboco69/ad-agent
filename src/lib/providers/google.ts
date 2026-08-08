import type {
  AdAssetRow,
  AdCreativeRow,
  AdProvider,
  CreativeReport,
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
  campaign?: { id?: string; name?: string; status?: string; campaignBudget?: string; advertisingChannelType?: string };
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
  smartCampaignSearchTermView?: { searchTerm?: string };
  conversionAction?: {
    resourceName?: string;
    name?: string;
    category?: string;
    type?: string;
    status?: string;
    primaryForGoal?: boolean;
    countingType?: string;
    valueSettings?: { defaultValue?: number };
    attributionModelSettings?: { attributionModel?: string };
  };
  changeEvent?: {
    changeDateTime?: string;
    changeResourceType?: string;
    resourceChangeOperation?: string;
    changedFields?: string;
  };
  adGroup?: { id?: string; name?: string };
  adGroupAd?: {
    adStrength?: string;
    status?: string;
    ad?: {
      id?: string;
      finalUrls?: string[];
      responsiveSearchAd?: {
        headlines?: Array<{ text?: string; pinnedField?: string }>;
        descriptions?: Array<{ text?: string; pinnedField?: string }>;
      };
    };
  };
  adGroupAdAssetView?: { fieldType?: string; performanceLabel?: string; pinnedField?: string };
  asset?: {
    id?: string;
    type?: string;
    textAsset?: { text?: string };
    sitelinkAsset?: { linkText?: string };
    calloutAsset?: { calloutText?: string };
    structuredSnippetAsset?: { header?: string; values?: string[] };
  };
  campaignAsset?: { fieldType?: string; status?: string };
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

    // 検索語句レポート（検索キャンペーン＋スマートキャンペーン。キャンペーン×語句で集計）。
    // スマートキャンペーンの語句は search_term_view に出ないため専用ビューも併せて引く。
    async listSearchTerms(conn, days): Promise<SearchTermRow[]> {
      const token = await freshToken(conn);
      const customerId = cid(conn);
      const dates = lastDatesJst(days);
      const range = `segments.date BETWEEN '${dates[0]}' AND '${dates[dates.length - 1]}'`;
      const metricsSel = `metrics.impressions, metrics.clicks, metrics.cost_micros,
                metrics.conversions, metrics.conversions_value`;

      const rows = await gaqlSearch(
        token,
        customerId,
        `SELECT search_term_view.search_term, campaign.id, campaign.name, ${metricsSel}
         FROM search_term_view
         WHERE ${range}
         ORDER BY metrics.cost_micros DESC
         LIMIT 500`,
        loginCid(conn)
      );
      // スマートキャンペーン分（無いアカウントではエラーになり得るため個別に握りつぶす）
      let smartRows: SearchRow[] = [];
      try {
        // 注意: このビューでは metrics.conversions / conversions_value は選択禁止
        // （PROHIBITED_METRIC_IN_SELECT_OR_WHERE_CLAUSE になる）。CVは0扱いで集計する。
        smartRows = await gaqlSearch(
          token,
          customerId,
          `SELECT smart_campaign_search_term_view.search_term, campaign.id, campaign.name,
                  metrics.impressions, metrics.clicks, metrics.cost_micros
           FROM smart_campaign_search_term_view
           WHERE ${range}
           LIMIT 500`,
          loginCid(conn)
        );
      } catch {
        // smart campaign 非対応・0件アカウントでは無視して通常分のみ返す
      }

      // search_term_view は広告グループ粒度なので、キャンペーン×語句で集計し直す
      const agg = new Map<string, SearchTermRow>();
      for (const r of [...rows, ...smartRows]) {
        const term = r.searchTermView?.searchTerm ?? r.smartCampaignSearchTermView?.searchTerm;
        const campaignId = r.campaign?.id;
        if (!term || !campaignId) continue;
        const key = `${campaignId} ${term}`;
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

    // キャンペーン単位の除外キーワードを追加。
    // SMART（スマートアシスト）キャンペーンは keyword 条件が使えず、除外キーワードテーマ方式で登録する。
    async addNegativeKeyword(conn, campaignExternalId, term, matchType): Promise<void> {
      const token = await freshToken(conn);
      const customerId = cid(conn);
      const info = await gaqlSearch(
        token,
        customerId,
        `SELECT campaign.advertising_channel_type FROM campaign WHERE campaign.id = ${Number(campaignExternalId)}`,
        loginCid(conn)
      );
      const isSmart = info[0]?.campaign?.advertisingChannelType === "SMART";
      const criterion = isSmart
        ? {
            campaign: `customers/${customerId}/campaigns/${campaignExternalId}`,
            negative: true,
            keywordTheme: { freeFormKeywordTheme: term },
          }
        : {
            campaign: `customers/${customerId}/campaigns/${campaignExternalId}`,
            negative: true,
            keyword: { text: term, matchType },
          };
      const res = await fetch(`${ADS_API}/customers/${customerId}/campaignCriteria:mutate`, {
        method: "POST",
        headers: adsHeaders(token, loginCid(conn)),
        body: JSON.stringify({ operations: [{ create: criterion }] }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as AdsErrorBody;
        throw new ProviderError(`除外キーワード追加に失敗: ${adsErrorMessage(json, res.status)}`);
      }
    },

    // 語句の昇格（手順書§2-A）: 検索CPは最初の有効な広告グループへ完全一致キーワード登録、
    // SMART はキーワードテーマとして追加する。
    async addKeyword(conn, campaignExternalId, term): Promise<void> {
      const token = await freshToken(conn);
      const customerId = cid(conn);
      const login = loginCid(conn);
      const info = await gaqlSearch(
        token,
        customerId,
        `SELECT campaign.advertising_channel_type FROM campaign WHERE campaign.id = ${Number(campaignExternalId)}`,
        login
      );
      if (info[0]?.campaign?.advertisingChannelType === "SMART") {
        const res = await fetch(`${ADS_API}/customers/${customerId}/campaignCriteria:mutate`, {
          method: "POST",
          headers: adsHeaders(token, login),
          body: JSON.stringify({
            operations: [
              {
                create: {
                  campaign: `customers/${customerId}/campaigns/${campaignExternalId}`,
                  keywordTheme: { freeFormKeywordTheme: term },
                },
              },
            ],
          }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as AdsErrorBody;
          throw new ProviderError(`キーワードテーマ追加に失敗: ${adsErrorMessage(json, res.status)}`);
        }
        return;
      }
      const groups = await gaqlSearch(
        token,
        customerId,
        `SELECT ad_group.id FROM ad_group WHERE campaign.id = ${Number(campaignExternalId)} AND ad_group.status = 'ENABLED' LIMIT 1`,
        login
      );
      const adGroupId = (groups[0] as { adGroup?: { id?: string } })?.adGroup?.id;
      if (!adGroupId) throw new ProviderError("有効な広告グループが見つかりません");
      const res = await fetch(`${ADS_API}/customers/${customerId}/adGroupCriteria:mutate`, {
        method: "POST",
        headers: adsHeaders(token, login),
        body: JSON.stringify({
          operations: [
            {
              create: {
                adGroup: `customers/${customerId}/adGroups/${adGroupId}`,
                status: "ENABLED",
                keyword: { text: term, matchType: "EXACT" },
              },
            },
          ],
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as AdsErrorBody;
        throw new ProviderError(`キーワード登録に失敗: ${adsErrorMessage(json, res.status)}`);
      }
    },

    // 広告アセットの評価と実績（クリエイティブPDCA）。
    // 3種のクエリを個別に try/catch し、1つ失敗しても取れた分は返す
    // （アセット系は広告タイプによって非対応のリソースがあるため）。
    async listCreatives(conn, days): Promise<CreativeReport> {
      const token = await freshToken(conn);
      const customerId = cid(conn);
      const login = loginCid(conn);
      const dates = lastDatesJst(days);
      const range = `segments.date BETWEEN '${dates[0]}' AND '${dates[dates.length - 1]}'`;
      const errors: string[] = [];

      // ① RSAの見出し・説明文ごとの評価と実績
      let assets: AdAssetRow[] = [];
      try {
        const rows = await gaqlSearch(
          token,
          customerId,
          `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_ad.ad.id,
                  ad_group_ad_asset_view.field_type, ad_group_ad_asset_view.performance_label,
                  ad_group_ad_asset_view.pinned_field, asset.text_asset.text,
                  metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
           FROM ad_group_ad_asset_view
           WHERE ${range} AND ad_group_ad.status != 'REMOVED'
           ORDER BY metrics.impressions DESC
           LIMIT 1000`,
          login
        );
        assets = rows
          .filter((r) => r.asset?.textAsset?.text)
          .map((r) => ({
            campaignExternalId: String(r.campaign?.id ?? ""),
            campaignName: r.campaign?.name ?? "(不明)",
            adGroupExternalId: r.adGroup?.id ? String(r.adGroup.id) : null,
            adGroupName: r.adGroup?.name ?? null,
            adExternalId: r.adGroupAd?.ad?.id ? String(r.adGroupAd.ad.id) : null,
            fieldType: r.adGroupAdAssetView?.fieldType ?? "UNKNOWN",
            text: r.asset!.textAsset!.text!,
            performanceLabel: r.adGroupAdAssetView?.performanceLabel ?? null,
            pinnedField:
              r.adGroupAdAssetView?.pinnedField && r.adGroupAdAssetView.pinnedField !== "UNSPECIFIED"
                ? r.adGroupAdAssetView.pinnedField
                : null,
            impressions: Number(r.metrics?.impressions ?? 0),
            clicks: Number(r.metrics?.clicks ?? 0),
            costYen: Math.round(Number(r.metrics?.costMicros ?? 0) / 1_000_000),
            conversions: Number(r.metrics?.conversions ?? 0),
          }));
      } catch (e) {
        errors.push(`見出し・説明文: ${e instanceof Error ? e.message : "取得失敗"}`);
      }

      // ② 広告（RSA）単位の有効性と入稿本数
      let creatives: AdCreativeRow[] = [];
      try {
        const rows = await gaqlSearch(
          token,
          customerId,
          `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
                  ad_group_ad.ad.id, ad_group_ad.ad_strength, ad_group_ad.ad.final_urls,
                  ad_group_ad.ad.responsive_search_ad.headlines,
                  ad_group_ad.ad.responsive_search_ad.descriptions
           FROM ad_group_ad
           WHERE ad_group_ad.status = 'ENABLED' AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
           LIMIT 500`,
          login
        );
        creatives = rows
          .filter((r) => r.adGroupAd?.ad?.id)
          .map((r) => {
            const rsa = r.adGroupAd?.ad?.responsiveSearchAd;
            const h = rsa?.headlines ?? [];
            const d = rsa?.descriptions ?? [];
            const pinned = [...h, ...d].filter((a) => a.pinnedField && a.pinnedField !== "UNSPECIFIED").length;
            return {
              campaignExternalId: String(r.campaign?.id ?? ""),
              campaignName: r.campaign?.name ?? "(不明)",
              adGroupExternalId: String(r.adGroup?.id ?? ""),
              adGroupName: r.adGroup?.name ?? "(不明)",
              adExternalId: String(r.adGroupAd!.ad!.id),
              adStrength: r.adGroupAd?.adStrength ?? null,
              headlineCount: h.length,
              descriptionCount: d.length,
              pinnedCount: pinned,
              finalUrl: r.adGroupAd?.ad?.finalUrls?.[0] ?? null,
            };
          });
      } catch (e) {
        errors.push(`広告の有効性: ${e instanceof Error ? e.message : "取得失敗"}`);
      }

      // ③ 拡張アセット（サイトリンク・コールアウト・構造化スニペット）の設定状況
      const extensionsByCampaign: Record<string, string[]> = {};
      try {
        const rows = await gaqlSearch(
          token,
          customerId,
          `SELECT campaign.id, campaign_asset.field_type, asset.type,
                  asset.sitelink_asset.link_text, asset.callout_asset.callout_text,
                  asset.structured_snippet_asset.header
           FROM campaign_asset
           WHERE campaign_asset.status != 'REMOVED'
           LIMIT 500`,
          login
        );
        for (const r of rows) {
          const cid2 = String(r.campaign?.id ?? "");
          const ft = r.campaignAsset?.fieldType;
          if (!cid2 || !ft) continue;
          if (!extensionsByCampaign[cid2]) extensionsByCampaign[cid2] = [];
          if (!extensionsByCampaign[cid2].includes(ft)) extensionsByCampaign[cid2].push(ft);
          // サイトリンク等のテキストもアセットとして扱い、実績なしで一覧に出す
          const text =
            r.asset?.sitelinkAsset?.linkText ??
            r.asset?.calloutAsset?.calloutText ??
            r.asset?.structuredSnippetAsset?.header;
          if (text && ["SITELINK", "CALLOUT", "STRUCTURED_SNIPPET"].includes(ft)) {
            assets.push({
              campaignExternalId: cid2,
              campaignName: r.campaign?.name ?? "(不明)",
              adGroupExternalId: null,
              adGroupName: null,
              adExternalId: null,
              fieldType: ft,
              text,
              performanceLabel: null,
              pinnedField: null,
              impressions: 0,
              clicks: 0,
              costYen: 0,
              conversions: 0,
            });
          }
        }
      } catch (e) {
        errors.push(`拡張アセット: ${e instanceof Error ? e.message : "取得失敗"}`);
      }

      return { assets, creatives, extensionsByCampaign, errors };
    },

    // RSAの見出し・説明文を差し替え／追加する。
    // ads:mutate は配列を丸ごと置き換えるため、現在の全アセットを取得してから組み立て直す。
    // 広告IDは変わらないので実績は引き継がれる（新規作成ではない）。
    async updateRsaAsset(conn, adExternalId, change) {
      const token = await freshToken(conn);
      const customerId = cid(conn);
      const login = loginCid(conn);

      const rows = await gaqlSearch(
        token,
        customerId,
        `SELECT ad_group_ad.ad.id, ad_group_ad.ad.responsive_search_ad.headlines,
                ad_group_ad.ad.responsive_search_ad.descriptions
         FROM ad_group_ad
         WHERE ad_group_ad.ad.id = ${Number(adExternalId)}`,
        login
      );
      const rsa = rows[0]?.adGroupAd?.ad?.responsiveSearchAd;
      if (!rsa) throw new ProviderError("対象の広告が見つかりません（レスポンシブ検索広告のみ編集できます）");

      const toAsset = (a: { text?: string; pinnedField?: string }) => ({
        text: a.text ?? "",
        ...(a.pinnedField && a.pinnedField !== "UNSPECIFIED" ? { pinnedField: a.pinnedField } : {}),
      });
      const headlines = (rsa.headlines ?? []).map(toAsset);
      const descriptions = (rsa.descriptions ?? []).map(toAsset);
      const list = change.fieldType === "HEADLINE" ? headlines : descriptions;
      const max = change.fieldType === "HEADLINE" ? 15 : 4;

      if (list.some((a) => a.text === change.newText)) {
        throw new ProviderError("同じ文言が既に登録されています");
      }
      if (change.mode === "replace") {
        const idx = list.findIndex((a) => a.text === change.oldText);
        if (idx < 0) throw new ProviderError("差し替え対象の文言が見つかりません（既に変更されている可能性があります）");
        // ピン留めは引き継ぐ（法務・ブランド上の固定を壊さないため）
        list[idx] = { ...list[idx], text: change.newText };
      } else {
        if (list.length >= max) {
          throw new ProviderError(
            `${change.fieldType === "HEADLINE" ? "見出し" : "説明文"}は上限${max}本です。追加するには既存を差し替えてください`
          );
        }
        list.push({ text: change.newText });
      }

      const res = await fetch(`${ADS_API}/customers/${customerId}/ads:mutate`, {
        method: "POST",
        headers: adsHeaders(token, login),
        body: JSON.stringify({
          operations: [
            {
              update: {
                resourceName: `customers/${customerId}/ads/${adExternalId}`,
                responsiveSearchAd: { headlines, descriptions },
              },
              updateMask: "responsive_search_ad.headlines,responsive_search_ad.descriptions",
            },
          ],
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as AdsErrorBody;
        throw new ProviderError(`広告の更新に失敗: ${adsErrorMessage(json, res.status)}`);
      }
      return { headlines: headlines.length, descriptions: descriptions.length };
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
        `SELECT conversion_action.resource_name, conversion_action.name, conversion_action.category, conversion_action.type,
                conversion_action.status, conversion_action.primary_for_goal,
                conversion_action.counting_type, conversion_action.value_settings.default_value,
                conversion_action.attribution_model_settings.attribution_model
         FROM conversion_action WHERE conversion_action.status = 'ENABLED'`,
        login
      );
      return {
        trackingStatus: cust[0]?.customer?.conversionTrackingSetting?.conversionTrackingStatus ?? "UNKNOWN",
        actions: actions.map((r) => ({
          resourceName: r.conversionAction?.resourceName ?? "",
          name: r.conversionAction?.name ?? "(不明)",
          category: r.conversionAction?.category ?? "",
          type: r.conversionAction?.type ?? "",
          primary: r.conversionAction?.primaryForGoal === true,
          countingType: r.conversionAction?.countingType ?? "",
          hasValue: (r.conversionAction?.valueSettings?.defaultValue ?? 0) > 0,
          attributionModel: r.conversionAction?.attributionModelSettings?.attributionModel ?? "",
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
