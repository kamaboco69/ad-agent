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

// 接続直後に既定の接続先（最初のGA4プロパティ / GSCサイト）を解決する
export async function resolveDefaultTarget(
  service: IntegrationId,
  accessToken: string
): Promise<{ externalId: string; name: string }> {
  const H = { Authorization: `Bearer ${accessToken}` };
  if (service === "ga4") {
    const res = await fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=50", { headers: H });
    const json = (await res.json().catch(() => ({}))) as {
      accountSummaries?: Array<{ propertySummaries?: Array<{ property?: string; displayName?: string }> }>;
    };
    const prop = json.accountSummaries?.flatMap((a) => a.propertySummaries ?? [])[0];
    if (!prop?.property) throw new Error("アクセス可能な GA4 プロパティが見つかりません");
    return { externalId: prop.property, name: prop.displayName ?? prop.property };
  }
  const res = await fetch("https://www.googleapis.com/webmasters/v3/sites", { headers: H });
  const json = (await res.json().catch(() => ({}))) as { siteEntry?: Array<{ siteUrl?: string }> };
  const site = json.siteEntry?.[0];
  if (!site?.siteUrl) throw new Error("アクセス可能な Search Console サイトが見つかりません");
  return { externalId: site.siteUrl, name: site.siteUrl };
}
