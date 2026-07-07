import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { syncConnection, DEFAULT_SYNC_DAYS } from "@/lib/sync";

// 手動同期
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { id } = await params;

  const conn = await prisma.adConnection.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!conn) return Response.json({ error: "not found" }, { status: 404 });

  const outcome = await syncConnection(conn, DEFAULT_SYNC_DAYS);
  if (!outcome.ok) return Response.json({ error: outcome.error, sync: outcome }, { status: 502 });
  return Response.json({ sync: outcome });
}
