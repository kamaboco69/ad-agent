import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";

// 既読・非表示の更新
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { id } = await params;

  const insight = await prisma.insight.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!insight) return Response.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { status?: string };
  if (body.status !== "read" && body.status !== "dismissed") {
    return Response.json({ error: "status は read / dismissed" }, { status: 400 });
  }

  await prisma.insight.update({ where: { id }, data: { status: body.status } });
  return Response.json({ ok: true });
}
