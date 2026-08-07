import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";

// PATCH: リードの有効判定・ファネル段階・受注金額を更新（人の判断は overridden で保護する）
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { id } = await params;

  const lead = await prisma.lead.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, leadAt: true },
  });
  if (!lead) return Response.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    validity?: string;
    stage?: string;
    lost?: boolean;
    dealAmountYen?: number | null;
  };

  const data: Record<string, unknown> = {};
  if (body.validity === "valid" || body.validity === "invalid" || body.validity === "unknown") {
    data.validity = body.validity;
    if (body.validity !== "invalid") data.invalidReason = null;
  }
  if (body.stage === "lead" || body.stage === "mql" || body.stage === "meeting" || body.stage === "won") {
    data.stage = body.stage;
    // 段階の到達日は未設定なら埋める（コホート集計で使う）
    if (body.stage === "mql") data.mqlAt = lead.leadAt;
    if (body.stage === "meeting" || body.stage === "won") data.meetingAt = lead.leadAt;
    data.wonAt = body.stage === "won" ? lead.leadAt : null;
    if (body.stage === "won") data.lost = false;
  }
  if (typeof body.lost === "boolean") data.lost = body.lost;
  if (body.dealAmountYen === null) data.dealAmountYen = null;
  if (typeof body.dealAmountYen === "number" && body.dealAmountYen >= 0) {
    data.dealAmountYen = Math.round(body.dealAmountYen);
  }
  if (Object.keys(data).length === 0) return Response.json({ error: "変更内容がありません" }, { status: 400 });

  data.overridden = true; // 再インポート時に自動判定で戻されないようにする
  const updated = await prisma.lead.update({ where: { id }, data });
  return Response.json({ lead: { id: updated.id, validity: updated.validity, stage: updated.stage } });
}

// DELETE: リードの削除
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { id } = await params;

  const lead = await prisma.lead.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!lead) return Response.json({ error: "not found" }, { status: 404 });

  await prisma.lead.delete({ where: { id } });
  return Response.json({ ok: true });
}
