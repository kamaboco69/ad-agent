import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { sendReportMail } from "@/lib/report-mail";

// PATCH: レポートの体裁・自動配信設定を保存。?send=1 でテスト送信も行う。
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { id } = await params;

  const conn = await prisma.adConnection.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!conn) return Response.json({ error: "not found" }, { status: 404 });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const bool = (v: unknown, dflt: boolean) => (typeof v === "boolean" ? v : dflt);

  const data = {
    clientName: str(b.clientName),
    agencyName: str(b.agencyName),
    logoUrl: str(b.logoUrl, 500),
    accentColor: /^#[0-9a-fA-F]{6}$/.test(String(b.accentColor)) ? String(b.accentColor) : "#0369a1",
    greeting: str(b.greeting, 500),
    showSummary: bool(b.showSummary, true),
    showPlatforms: bool(b.showPlatforms, true),
    showCampaigns: bool(b.showCampaigns, true),
    showInsight: bool(b.showInsight, true),
    showActions: bool(b.showActions, true),
    showLeads: bool(b.showLeads, false),
    autoSend: bool(b.autoSend, false),
    sendDay: Math.min(28, Math.max(1, Number(b.sendDay) || 1)),
    recipients: str(b.recipients, 1000),
  };

  const tpl = await prisma.reportTemplate.upsert({
    where: { connectionId: id },
    update: data,
    create: { organizationId: ctx.organizationId, connectionId: id, ...data },
  });

  if (new URL(req.url).searchParams.get("send") === "1") {
    if (!tpl.recipients) return Response.json({ error: "宛先が未設定です" }, { status: 400 });
    try {
      const sent = await sendReportMail(ctx.organizationId, id);
      return Response.json({ template: tpl, sent });
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : "送信に失敗しました" }, { status: 502 });
    }
  }
  return Response.json({ template: tpl });
}
