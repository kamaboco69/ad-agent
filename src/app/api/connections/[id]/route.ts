import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";

// 接続設定の更新（月予算・表示名）
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { id } = await params;

  const conn = await prisma.adConnection.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!conn) return Response.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { monthlyBudgetYen?: number | null; accountName?: string };
  const data: Record<string, unknown> = {};
  if (body.monthlyBudgetYen === null) data.monthlyBudgetYen = null;
  if (typeof body.monthlyBudgetYen === "number" && body.monthlyBudgetYen >= 0) {
    data.monthlyBudgetYen = Math.round(body.monthlyBudgetYen);
  }
  if (typeof body.accountName === "string" && body.accountName.trim()) {
    data.accountName = body.accountName.trim();
  }
  if (Object.keys(data).length === 0) return Response.json({ error: "変更内容がありません" }, { status: 400 });

  const updated = await prisma.adConnection.update({ where: { id }, data });
  return Response.json({ connection: { id: updated.id, monthlyBudgetYen: updated.monthlyBudgetYen } });
}

// 接続解除（キャンペーン・実績もカスケード削除）
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { id } = await params;

  const conn = await prisma.adConnection.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!conn) return Response.json({ error: "not found" }, { status: 404 });

  await prisma.adConnection.delete({ where: { id } });
  return Response.json({ ok: true });
}
