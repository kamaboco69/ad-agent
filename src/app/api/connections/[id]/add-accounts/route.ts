import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { syncConnection, DEFAULT_SYNC_DAYS } from "@/lib/sync";

// POST: 既存接続の認可トークンを流用して、選択したアカウントを別接続として追加する。
// 同一アカウントの重複はスキップ。追加後は各接続をベストエフォートで初回同期。
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { id } = await params;

  const src = await prisma.adConnection.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!src) return Response.json({ error: "not found" }, { status: 404 });
  if (src.mode !== "api") return Response.json({ error: "デモ接続では使えません" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as {
    accounts?: Array<{ id?: string; loginCustomerId?: string | null; name?: string }>;
  };
  const accounts = (body.accounts ?? []).filter((a) => a.id && a.name);
  if (accounts.length === 0) return Response.json({ error: "アカウントが選択されていません" }, { status: 400 });

  let created = 0;
  let skipped = 0;
  for (const a of accounts) {
    const exists = await prisma.adConnection.findFirst({
      where: {
        organizationId: ctx.organizationId,
        platform: src.platform,
        mode: "api",
        externalAccountId: a.id,
      },
      select: { id: true },
    });
    if (exists) {
      skipped++;
      continue;
    }
    const conn = await prisma.adConnection.create({
      data: {
        organizationId: ctx.organizationId,
        platform: src.platform,
        mode: "api",
        status: "connected",
        accountName: a.name!,
        externalAccountId: a.id!,
        loginCustomerId: a.loginCustomerId ?? null,
        accessToken: src.accessToken, // 暗号化済みトークンをそのまま流用（同一ユーザーの認可）
        refreshToken: src.refreshToken,
        tokenExpiresAt: src.tokenExpiresAt,
        scope: src.scope,
      },
    });
    await syncConnection(conn, DEFAULT_SYNC_DAYS); // 失敗しても lastError に記録される
    created++;
  }
  return Response.json({ created, skipped });
}
