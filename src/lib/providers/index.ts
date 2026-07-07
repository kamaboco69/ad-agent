import type { PlatformId } from "@/lib/platforms";
import type { AdProvider } from "./types";
import { createDemoProvider } from "./demo";
import { createGoogleProvider } from "./google";
import { createMetaProvider } from "./meta";
import { createTiktokProvider } from "./tiktok";
import { createYahooProvider } from "./yahoo";
import { createXProvider } from "./x";

export type { AdProvider, ProviderConnection, SyncResult, TokenSet } from "./types";
export { ProviderError } from "./types";
export { demoAccountName } from "./demo";

const API_PROVIDERS: Record<PlatformId, () => AdProvider> = {
  google: createGoogleProvider,
  yahoo: createYahooProvider,
  meta: () => createMetaProvider("meta"),
  instagram: () => createMetaProvider("instagram"),
  x: createXProvider,
  tiktok: createTiktokProvider,
};

// mode=demo はデモデータ生成、mode=api は実APIアダプタを返す
export function getProvider(platform: PlatformId, mode: string): AdProvider {
  if (mode === "api") return API_PROVIDERS[platform]();
  return createDemoProvider(platform);
}

// 実API接続（OAuth開始）が可能か
export function apiConnectAvailable(platform: PlatformId): boolean {
  return API_PROVIDERS[platform]().configured();
}
