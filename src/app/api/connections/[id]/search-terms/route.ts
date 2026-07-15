import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { syncSearchTerms } from "@/lib/search-terms";

// GET: 保存済みの検索語句一覧（消化額の大きい順）
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { id } = await params;

  const conn = await prisma.adConnection.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!conn) return Response.json({ error: "not found" }, { status: 404 });

  const terms = await prisma.searchTerm.findMany({
    where: { connectionId: id },
    orderBy: { costYen: "desc" },
    take: 300,
  });
  return Response.json({ terms });
}

// POST: 媒体から検索語句レポートを同期
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { id } = await params;

  const conn = await prisma.adConnection.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!conn) return Response.json({ error: "not found" }, { status: 404 });
  if (conn.mode !== "api") {
    return Response.json({ error: "デモ接続では検索語句レポートは使えません" }, { status: 400 });
  }

  try {
    const count = await syncSearchTerms(conn);
    return Response.json({ synced: count });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: message }, { status: 502 });
  }
}
