import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { getProvider, ProviderError } from "@/lib/providers";
import { toProviderConnection } from "@/lib/sync";

// キャンペーンの操作: ステータス（配信/停止）・日予算の変更。
// mode=api の接続は媒体APIへ反映してからDBを更新。demo はDBのみ。
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { id } = await params;

  const campaign = await prisma.campaign.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: { connection: true },
  });
  if (!campaign) return Response.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { status?: string; dailyBudgetYen?: number };
  const wantStatus = body.status === "active" || body.status === "paused" ? body.status : undefined;
  const wantBudget =
    typeof body.dailyBudgetYen === "number" && body.dailyBudgetYen > 0
      ? Math.round(body.dailyBudgetYen)
      : undefined;
  if (!wantStatus && !wantBudget) return Response.json({ error: "変更内容がありません" }, { status: 400 });

  try {
    const provider = getProvider(toProviderConnection(campaign.connection).platform, campaign.connection.mode);
    const pconn = toProviderConnection(campaign.connection);
    if (wantStatus) await provider.setCampaignStatus(pconn, campaign.externalId, wantStatus);
    if (wantBudget) await provider.setDailyBudget(pconn, campaign.externalId, wantBudget);
  } catch (e) {
    if (e instanceof ProviderError) return Response.json({ error: e.message }, { status: 502 });
    throw e;
  }

  const updated = await prisma.campaign.update({
    where: { id },
    data: {
      ...(wantStatus ? { status: wantStatus } : {}),
      ...(wantBudget ? { dailyBudgetYen: wantBudget } : {}),
    },
    select: { id: true, status: true, dailyBudgetYen: true },
  });
  return Response.json({ campaign: updated });
}
