import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getOrgContext } from "@/lib/auth-helpers";
import { diagnoseCreatives, scoreAsset } from "@/lib/creatives";
import { CreativesClient, type AdBlock, type AssetRow } from "./CreativesClient";

export const dynamic = "force-dynamic";

// 広告クリエイティブのPDCA。有効な広告ごとに見出し・説明文を並べ、
// 実際の反応（同じ広告内での相対CTR・CV貢献）でスコアを付ける。

export default async function CreativesPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");

  const [assets, creatives, conns] = await Promise.all([
    prisma.adAsset.findMany({ where: { organizationId: ctx.organizationId }, take: 1000 }),
    prisma.adCreative.findMany({ where: { organizationId: ctx.organizationId }, take: 200 }),
    prisma.adConnection.findMany({
      where: { organizationId: ctx.organizationId, platform: "google", mode: "api" },
      select: { id: true, accountName: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const findings = diagnoseCreatives(assets, creatives);

  // 広告ごとにまとめ、同じ広告・同じ種別の中で相対評価する
  const blocks: AdBlock[] = creatives
    .map((c) => {
      const mine = assets.filter((a) => a.adExternalId === c.adExternalId);
      const build = (fieldType: "HEADLINE" | "DESCRIPTION"): AssetRow[] => {
        const group = mine.filter((a) => a.fieldType === fieldType);
        return group
          .map((a) => {
            const s = scoreAsset(a, group);
            return {
              id: a.id,
              fieldType: a.fieldType,
              text: a.text,
              performanceLabel: a.performanceLabel,
              pinned: !!a.pinnedField,
              impressions: a.impressions,
              clicks: a.clicks,
              conversions: a.conversions,
              score: s.score,
              grade: s.grade,
              basis: s.basis,
              ctrIndex: s.ctrIndex,
              notes: s.notes,
              aiVerdict: a.aiVerdict,
              aiSuggestion: a.aiSuggestion,
              aiReason: a.aiReason,
            };
          })
          .sort((x, y) => (y.score ?? -1) - (x.score ?? -1));
      };
      return {
        adExternalId: c.adExternalId,
        campaignName: c.campaignName,
        adGroupName: c.adGroupName,
        adStrength: c.adStrength,
        headlineCount: c.headlineCount,
        descriptionCount: c.descriptionCount,
        pinnedCount: c.pinnedCount,
        extensions: (c.extensions ?? "").split(",").filter(Boolean),
        headlines: build("HEADLINE"),
        descriptions: build("DESCRIPTION"),
      };
    })
    // 実績のある広告を上に、次いで有効性が低い広告を上に出す
    .sort((a, b) => {
      const impA = a.headlines.reduce((n, x) => n + x.impressions, 0);
      const impB = b.headlines.reduce((n, x) => n + x.impressions, 0);
      if (impA !== impB) return impB - impA;
      const rank = (s: string | null) => (s === "POOR" ? 0 : s === "AVERAGE" ? 1 : 2);
      return rank(a.adStrength) - rank(b.adStrength);
    });

  const extensions: AssetRow[] = assets
    .filter((a) => !["HEADLINE", "DESCRIPTION"].includes(a.fieldType))
    .map((a) => ({
      id: a.id,
      fieldType: a.fieldType,
      text: a.text,
      performanceLabel: null,
      pinned: false,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      score: null,
      grade: null,
      basis: "insufficient" as const,
      ctrIndex: null,
      notes: [],
      aiVerdict: null,
      aiSuggestion: null,
      aiReason: null,
      campaignName: a.campaignName,
    }));

  return <CreativesClient connections={conns} blocks={blocks} extensions={extensions} findings={findings} />;
}
