import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext } from "@/lib/auth-helpers";
import { isPlatformId } from "@/lib/platforms";
import { getProvider } from "@/lib/providers";
import { syncConnection, DEFAULT_SYNC_DAYS } from "@/lib/sync";
import { appBaseUrl } from "@/lib/base-url";
import { encryptSecret } from "@/lib/crypto";

// OAuth コールバック: code をトークンに交換し、接続を保存して初回同期。
export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const back = (q: string) => NextResponse.redirect(`${appBaseUrl()}/?${q}`);
  if (!isPlatformId(platform)) return back("connect_error=unsupported");

  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.redirect(`${appBaseUrl()}/login`);

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get(`adagent_oauth_state_${platform}`)?.value;
  if (!code || !state || !cookieState || state !== cookieState) {
    return back("connect_error=state");
  }

  try {
    const provider = getProvider(platform, "api");
    const redirectUri = `${appBaseUrl()}/api/platforms/${platform}/callback`;
    const token = await provider.exchangeCode(code, redirectUri);

    const conn = await prisma.adConnection.create({
      data: {
        organizationId: ctx.organizationId,
        platform,
        mode: "api",
        status: "connected",
        accountName: token.accountName ?? `${platform} アカウント`,
        externalAccountId: token.externalAccountId,
        accessToken: encryptSecret(token.accessToken),
        refreshToken: token.refreshToken ? encryptSecret(token.refreshToken) : null,
        tokenExpiresAt: token.expiresAt,
        scope: token.scope,
      },
    });

    // 初回同期はベストエフォート（失敗しても接続自体は作る。lastError に記録される）
    await syncConnection(conn, DEFAULT_SYNC_DAYS);

    const res = back("connected=" + platform);
    res.cookies.delete(`adagent_oauth_state_${platform}`);
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    return back(`connect_error=${encodeURIComponent(message)}`);
  }
}
