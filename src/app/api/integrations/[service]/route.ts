import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { appBaseUrl } from "@/lib/base-url";
import { encryptionEnabled } from "@/lib/crypto";
import { integrationAuthUrl, integrationConfigured, isIntegrationId } from "@/lib/integrations";

// GET: 分析サービス連携の OAuth を開始（ワンタッチ承認）
export async function GET(_req: NextRequest, { params }: { params: Promise<{ service: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { service } = await params;
  if (!isIntegrationId(service)) return Response.json({ error: "未対応のサービスです" }, { status: 400 });
  if (!encryptionEnabled() || !integrationConfigured()) {
    return Response.json({ error: "連携用の資格情報が未設定です" }, { status: 400 });
  }

  const nonce = crypto.randomBytes(16).toString("hex");
  const state = `${service}:${nonce}`;
  const redirectUri = `${appBaseUrl()}/api/integrations/google/callback`;
  const res = NextResponse.redirect(integrationAuthUrl(service, state, redirectUri));
  res.cookies.set("adagent_integ_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return res;
}

// DELETE: 連携解除
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ service: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { service } = await params;
  await prisma.integration.deleteMany({ where: { organizationId: ctx.organizationId, service } });
  return Response.json({ ok: true });
}
