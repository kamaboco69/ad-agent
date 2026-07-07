// 対応する広告媒体の定義（ID・表示名・ブランドカラー・実API接続に必要な環境変数）。
// UI とプロバイダ層の両方から参照する唯一の媒体レジストリ。

export const PLATFORM_IDS = ["google", "yahoo", "meta", "instagram", "x", "tiktok"] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export interface PlatformDef {
  id: PlatformId;
  label: string; // 日本語表示名
  short: string; // カード等で使う短い名前
  color: string; // ブランドカラー（チャート・バッジ用）
  envKeys: string[]; // 実API接続（OAuth）に必要な環境変数
  apiName: string; // 使用するAPIの名称（設定画面の案内用）
  note?: string; // 接続時の補足
}

export const PLATFORMS: Record<PlatformId, PlatformDef> = {
  google: {
    id: "google",
    label: "Google 広告",
    short: "Google",
    color: "#4285F4",
    envKeys: ["GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN"],
    apiName: "Google Ads API",
    note: "開発者トークン（Basic access 以上）の承認が必要",
  },
  yahoo: {
    id: "yahoo",
    label: "Yahoo! 広告",
    short: "Yahoo!",
    color: "#FF0033",
    envKeys: ["YAHOO_ADS_CLIENT_ID", "YAHOO_ADS_CLIENT_SECRET"],
    apiName: "Yahoo!広告 API",
    note: "API 利用申請（代理店/ツールベンダー審査）の承認が必要",
  },
  meta: {
    id: "meta",
    label: "Meta 広告（Facebook）",
    short: "Meta",
    color: "#0866FF",
    envKeys: ["META_ADS_APP_ID", "META_ADS_APP_SECRET"],
    apiName: "Meta Marketing API",
    note: "ads_read / ads_management 権限のアプリレビューが必要",
  },
  instagram: {
    id: "instagram",
    label: "Instagram 広告",
    short: "Instagram",
    color: "#E1306C",
    envKeys: ["META_ADS_APP_ID", "META_ADS_APP_SECRET"],
    apiName: "Meta Marketing API",
    note: "Meta と同じアプリを使用（配面 publisher_platform=instagram で絞り込み）",
  },
  x: {
    id: "x",
    label: "X 広告",
    short: "X",
    color: "#8b5cf6", // ブランドは黒だがチャートで判別できないため紫を割当（CVD検証済み）
    envKeys: ["X_ADS_CONSUMER_KEY", "X_ADS_CONSUMER_SECRET"],
    apiName: "X Ads API",
    note: "Ads API アクセス申請の承認が必要（OAuth 1.0a）",
  },
  tiktok: {
    id: "tiktok",
    label: "TikTok 広告",
    short: "TikTok",
    color: "#0e9db8", // ブランドの水色を暗所向けに暗めへ調整（CVD検証済み）
    envKeys: ["TIKTOK_ADS_APP_ID", "TIKTOK_ADS_APP_SECRET"],
    apiName: "TikTok Business API",
    note: "TikTok for Business 開発者アプリの審査承認が必要",
  },
};

export function isPlatformId(v: string): v is PlatformId {
  return (PLATFORM_IDS as readonly string[]).includes(v);
}

// 実APIに必要な環境変数が揃っているか（未設定の媒体はデモ接続のみ可能）
export function platformApiConfigured(id: PlatformId): boolean {
  return PLATFORMS[id].envKeys.every((k) => !!process.env[k]);
}
