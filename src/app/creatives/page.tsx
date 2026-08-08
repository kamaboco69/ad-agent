import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getOrgContext } from "@/lib/auth-helpers";
import { diagnoseCreatives } from "@/lib/creatives";
import { CreativesClient, type AssetRow, type CreativeRow } from "./CreativesClient";

export const dynamic = "force-dynamic";

// 広告クリエイティブのPDCA。どの見出し・説明文が効いていて、どれを差し替えるべきかを出す。

export default async function CreativesPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");

  const [assets, creatives, conns] = await Promise.all([
    prisma.adAsset.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: [{ impressions: "desc" }],
      take: 500,
    }),
    prisma.adCreative.findMany({ where: { organizationId: ctx.organizationId }, take: 200 }),
    prisma.adConnection.findMany({
      where: { organizationId: ctx.organizationId, platform: "google", mode: "api" },
      select: { id: true, accountName: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const findings = diagnoseCreatives(assets, creatives);

  const assetRows: AssetRow[] = assets.map((a) => ({
    id: a.id,
    fieldType: a.fieldType,
    text: a.text,
    performanceLabel: a.performanceLabel,
    pinned: !!a.pinnedField,
    impressions: a.impressions,
    clicks: a.clicks,
    conversions: a.conversions,
    campaignName: a.campaignName,
    adGroupName: a.adGroupName,
    lowDays: a.lowSince ? Math.floor((Date.now() - a.lowSince.getTime()) / 86400_000) : null,
    aiVerdict: a.aiVerdict,
    aiSuggestion: a.aiSuggestion,
    aiReason: a.aiReason,
  }));

  const creativeRows: CreativeRow[] = creatives.map((c) => ({
    id: c.id,
    campaignName: c.campaignName,
    adGroupName: c.adGroupName,
    adStrength: c.adStrength,
    headlineCount: c.headlineCount,
    descriptionCount: c.descriptionCount,
    pinnedCount: c.pinnedCount,
    extensions: (c.extensions ?? "").split(",").filter(Boolean),
  }));

  return (
    <CreativesClient
      connections={conns}
      assets={assetRows}
      creatives={creativeRows}
      findings={findings}
    />
  );
}
