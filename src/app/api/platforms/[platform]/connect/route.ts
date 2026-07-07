import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { isPlatformId } from "@/lib/platforms";
import { getProvider, demoAccountName } from "@/lib/providers";
import { syncConnection, DEFAULT_SYNC_DAYS } from "@/lib/sync";
import { appBaseUrl } from "@/lib/base-url";
import { encryptionEnabled } from "@/lib/crypto";

// POST: デモ接続を作成して初回同期（資格情報不要ですぐ動く）
export async function POST(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { platform } = await params;
  if (!isPlatformId(platform)) return Response.json({ error: "未対応の媒体です" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { mode?: string };
  if (body.mode && body.mode !== "demo") {
    return Response.json({ error: "実API接続は GET /connect（OAuth）を使用してください" }, { status: 400 });
  }

  const existing = await prisma.adConnection.findFirst({
    where: { organizationId: ctx.organizationId, platform, mode: "demo" },
    select: { id: true },
  });
  if (existing) return Response.json({ error: "この媒体のデモ接続は既に存在します" }, { status: 409 });

  const conn = await prisma.adConnection.create({
    data: {
      organizationId: ctx.organizationId,
      platform,
      mode: "demo",
      status: "connected",
      accountName: demoAccountName(platform),
      externalAccountId: `demo-${platform}`,
    },
  });

  const outcome = await syncConnection(conn, DEFAULT_SYNC_DAYS);
  return Response.json({ connection: { id: conn.id }, sync: outcome });
}

// GET: 実API接続の OAuth を開始（対象媒体の環境変数が設定されている場合のみ）
export async function GET(_req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { platform } = await params;
  if (!isPlatformId(platform)) return Response.json({ error: "未対応の媒体です" }, { status: 400 });

  if (!encryptionEnabled()) {
    return Response.json({ error: "ENCRYPTION_KEY が未設定のため実API接続は使えません" }, { status: 400 });
  }

  const provider = getProvider(platform, "api");
  if (!provider.configured()) {
    return Response.json(
      { error: "この媒体のAPI資格情報（環境変数）が未設定です。デモ接続をご利用ください。" },
      { status: 400 }
    );
  }

  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${appBaseUrl()}/api/platforms/${platform}/callback`;

  let authUrl: string;
  try {
    authUrl = provider.authUrl(state, redirectUri);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "OAuth未対応の媒体です" }, { status: 400 });
  }

  const res = NextResponse.redirect(authUrl);
  res.cookies.set(`adagent_oauth_state_${platform}`, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return res;
}
