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

// PATCH: 対象プロパティ/サイトの切替、または一覧取得（body: {list:true} で一覧）
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ service: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { service } = await params;
  if (!isIntegrationId(service)) return Response.json({ error: "未対応のサービスです" }, { status: 400 });
  const integ = await prisma.integration.findFirst({
    where: { organizationId: ctx.organizationId, service },
  });
  if (!integ?.refreshToken) return Response.json({ error: "未連携です" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { list?: boolean; externalId?: string; name?: string };
  if (body.list) {
    const { decryptSecret } = await import("@/lib/crypto");
    const { refreshIntegrationToken, listTargets } = await import("@/lib/integrations");
    const token = await refreshIntegrationToken(decryptSecret(integ.refreshToken)!);
    if (!token) return Response.json({ error: "トークン更新に失敗しました。再連携してください" }, { status: 502 });
    return Response.json({ targets: await listTargets(service, token) });
  }
  if (!body.externalId || !body.name) return Response.json({ error: "対象が指定されていません" }, { status: 400 });
  await prisma.integration.update({
    where: { id: integ.id },
    data: { externalId: body.externalId, accountName: body.name },
  });
  return Response.json({ ok: true });
}

// DELETE: 連携解除
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ service: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { service } = await params;
  await prisma.integration.deleteMany({ where: { organizationId: ctx.organizationId, service } });
  return Response.json({ ok: true });
}
