// 分析サービス連携レジストリ（媒体=PLATFORMS の分析版）。
// Google系はログイン用とは別に GOOGLE_ADS_CLIENT_ID/SECRET の OAuth クライアントを流用し、
// サービスごとのスコープで同意を取る（ワンタッチ承認）。

export const INTEGRATION_IDS = ["ga4", "gsc"] as const;
export type IntegrationId = (typeof INTEGRATION_IDS)[number];

export interface IntegrationDef {
  id: IntegrationId;
  label: string;
  scope: string;
  apiName: string;
}

export const INTEGRATIONS: Record<IntegrationId, IntegrationDef> = {
  ga4: {
    id: "ga4",
    label: "Google アナリティクス（GA4）",
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    apiName: "GA4 Data API",
  },
  gsc: {
    id: "gsc",
    label: "Google Search Console",
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    apiName: "Search Console API",
  },
};

export function isIntegrationId(v: string): v is IntegrationId {
  return (INTEGRATION_IDS as readonly string[]).includes(v);
}

const clientId = () => process.env.GOOGLE_ADS_CLIENT_ID ?? "";
const clientSecret = () => process.env.GOOGLE_ADS_CLIENT_SECRET ?? "";

export function integrationConfigured(): boolean {
  return !!(clientId() && clientSecret());
}

export function integrationAuthUrl(service: IntegrationId, state: string, redirectUri: string): string {
  const qs = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: INTEGRATIONS[service].scope,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${qs}`;
}

export async function exchangeIntegrationCode(code: string, redirectUri: string) {
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
  const json = (await res.json()) as { access_token?: string; refresh_token?: string; error_description?: string };
  if (!json.access_token) throw new Error(`トークン交換に失敗: ${json.error_description ?? "unknown"}`);
  return json;
}

// リフレッシュトークンからアクセストークンを取得（GA4/GSC 読み取り用）
export async function refreshIntegrationToken(refreshToken: string): Promise<string | null> {
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
  const json = (await res.json().catch(() => ({}))) as { access_token?: string };
  return json.access_token ?? null;
}

// GA4: 直近28日のチャネル別＋ランディングページ別サマリーをテキスト化
export async function ga4SummaryText(property: string, token: string): Promise<string> {
  const run = async (body: Record<string, unknown>) => {
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json().catch(() => ({}))) as {
      rows?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }>;
    };
  };
  const dateRanges = [{ startDate: "28daysAgo", endDate: "yesterday" }];
  const metrics = [{ name: "sessions" }, { name: "engagementRate" }, { name: "conversions" }];
  const ch = await run({ dateRanges, metrics, dimensions: [{ name: "sessionDefaultChannelGroup" }], limit: 8 });
  const lp = await run({
    dateRanges,
    metrics,
    dimensions: [{ name: "landingPage" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 10,
  });
  const row = (r: { dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }) => {
    const [s, e, c] = (r.metricValues ?? []).map((m) => Number(m.value ?? 0));
    return `${r.dimensionValues?.[0]?.value ?? "?"}: セッション${s} / エンゲージ率${(e * 100).toFixed(0)}% / CV${c}`;
  };
  const lines: string[] = ["【GA4（直近28日）】"];
  if (ch.rows?.length) lines.push("チャネル別:", ...ch.rows.map((r) => `- ${row(r)}`));
  if (lp.rows?.length) lines.push("ランディングページ別(上位):", ...lp.rows.map((r) => `- ${row(r)}`));
  return lines.length > 1 ? lines.join("\n") : "";
}

// GSC: 直近28日の検索クエリ上位をテキスト化
export async function gscSummaryText(siteUrl: string, token: string): Promise<string> {
  const end = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
  const start = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: start, endDate: end, dimensions: ["query"], rowLimit: 15 }),
    }
  );
  const json = (await res.json().catch(() => ({}))) as {
    rows?: Array<{ keys?: string[]; clicks?: number; impressions?: number; position?: number }>;
  };
  if (!json.rows?.length) return "";
  return (
    "【Search Console 自然検索（直近28日・上位クエリ）】\n" +
    json.rows
      .map((r) => `- 「${r.keys?.[0]}」 クリック${r.clicks} / 表示${r.impressions} / 平均順位${r.position?.toFixed(1)}`)
      .join("\n")
  );
}

// 選択可能な接続先（GA4プロパティ / GSCサイト）の一覧
export async function listTargets(
  service: IntegrationId,
  accessToken: string
): Promise<Array<{ externalId: string; name: string }>> {
  const H = { Authorization: `Bearer ${accessToken}` };
  if (service === "ga4") {
    const res = await fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=50", { headers: H });
    const json = (await res.json().catch(() => ({}))) as {
      accountSummaries?: Array<{ propertySummaries?: Array<{ property?: string; displayName?: string }> }>;
    };
    return (json.accountSummaries ?? [])
      .flatMap((a) => a.propertySummaries ?? [])
      .filter((p) => p.property)
      .map((p) => ({ externalId: p.property!, name: p.displayName ?? p.property! }));
  }
  const res = await fetch("https://www.googleapis.com/webmasters/v3/sites", { headers: H });
  const json = (await res.json().catch(() => ({}))) as { siteEntry?: Array<{ siteUrl?: string }> };
  return (json.siteEntry ?? []).filter((s) => s.siteUrl).map((s) => ({ externalId: s.siteUrl!, name: s.siteUrl! }));
}

// 接続直後の既定は一覧の先頭（後から「対象変更」で切替可能）
export async function resolveDefaultTarget(
  service: IntegrationId,
  accessToken: string
): Promise<{ externalId: string; name: string }> {
  const targets = await listTargets(service, accessToken);
  if (!targets[0]) throw new Error(`アクセス可能な${service === "ga4" ? " GA4 プロパティ" : " Search Console サイト"}が見つかりません`);
  return targets[0];
}
