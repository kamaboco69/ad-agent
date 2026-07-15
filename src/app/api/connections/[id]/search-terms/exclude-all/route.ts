import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { excludeRecommended } from "@/lib/search-terms";

// POST: AIが除外推奨と判定した語句（CV0のみ）を一括で媒体に除外登録する
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { id } = await params;

  const conn = await prisma.adConnection.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!conn) return Response.json({ error: "not found" }, { status: 404 });
  if (conn.mode !== "api") return Response.json({ error: "デモ接続では除外登録はできません" }, { status: 400 });

  try {
    const { excluded, failed } = await excludeRecommended(conn);
    return Response.json({ excluded: excluded.length, failed });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: message }, { status: 502 });
  }
}
