import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getOrgContext } from "@/lib/auth-helpers";
import { mailConfigured } from "@/lib/report-mail";
import { TemplateClient } from "./TemplateClient";

export const dynamic = "force-dynamic";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  const { id } = await params;

  const conn = await prisma.adConnection.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, accountName: true },
  });
  if (!conn) notFound();

  const tpl = await prisma.reportTemplate.findUnique({ where: { connectionId: id } });

  return (
    <TemplateClient
      connectionId={id}
      accountName={conn.accountName}
      mailReady={mailConfigured()}
      initial={{
        clientName: tpl?.clientName ?? "",
        agencyName: tpl?.agencyName ?? "",
        logoUrl: tpl?.logoUrl ?? "",
        accentColor: tpl?.accentColor ?? "#0369a1",
        greeting: tpl?.greeting ?? "",
        showSummary: tpl?.showSummary ?? true,
        showPlatforms: tpl?.showPlatforms ?? true,
        showCampaigns: tpl?.showCampaigns ?? true,
        showInsight: tpl?.showInsight ?? true,
        showActions: tpl?.showActions ?? true,
        showLeads: tpl?.showLeads ?? false,
        autoSend: tpl?.autoSend ?? false,
        sendDay: tpl?.sendDay ?? 1,
        recipients: tpl?.recipients ?? "",
      }}
      lastSentAt={tpl?.lastSentAt?.toISOString().slice(0, 10) ?? null}
    />
  );
}
