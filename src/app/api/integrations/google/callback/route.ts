import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext } from "@/lib/auth-helpers";
import { appBaseUrl } from "@/lib/base-url";
import { encryptSecret } from "@/lib/crypto";
import { exchangeIntegrationCode, isIntegrationId, resolveDefaultTarget } from "@/lib/integrations";

// Google系 分析サービス連携の共有コールバック（state 先頭にサービスIDを載せる）
export async function GET(req: NextRequest) {
  const back = (q: string) => NextResponse.redirect(`${appBaseUrl()}/?${q}`);
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.redirect(`${appBaseUrl()}/login`);

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("adagent_integ_state")?.value;
  if (!code || !state || !cookieState || state !== cookieState) return back("integ_error=state");
  const service = state.split(":")[0];
  if (!isIntegrationId(service)) return back("integ_error=service");

  try {
    const redirectUri = `${appBaseUrl()}/api/integrations/google/callback`;
    const token = await exchangeIntegrationCode(code, redirectUri);
    const target = await resolveDefaultTarget(service, token.access_token!);

    await prisma.integration.upsert({
      where: { organizationId_service: { organizationId: ctx.organizationId, service } },
      update: {
        status: "connected",
        accountName: target.name,
        externalId: target.externalId,
        accessToken: encryptSecret(token.access_token!),
        refreshToken: token.refresh_token ? encryptSecret(token.refresh_token) : undefined,
      },
      create: {
        organizationId: ctx.organizationId,
        service,
        status: "connected",
        accountName: target.name,
        externalId: target.externalId,
        accessToken: encryptSecret(token.access_token!),
        refreshToken: token.refresh_token ? encryptSecret(token.refresh_token) : null,
      },
    });

    const res = back(`integ_connected=${service}`);
    res.cookies.delete("adagent_integ_state");
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    return back(`integ_error=${encodeURIComponent(message)}`);
  }
}
