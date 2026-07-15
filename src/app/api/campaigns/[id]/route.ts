import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { getProvider, ProviderError } from "@/lib/providers";
import { toProviderConnection } from "@/lib/sync";
import { logChange } from "@/lib/rules";

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

  // 学習期間ハードガード（手順書§4）: block モードでは、同一キャンペーンに14日以内の変更が
  // ある場合、追加の大変更（ステータス/予算）を拒否する（1変更1検証）。
  if (campaign.connection.mode === "api" && campaign.connection.learningGuardMode === "block") {
    const recent = await prisma.changeLog.findFirst({
      where: {
        campaignId: id,
        kind: { in: ["status", "dailyBudget"] },
        createdAt: { gte: new Date(Date.now() - 14 * 86400_000) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (recent) {
      return Response.json(
        {
          error: `学習期間ガード: このキャンペーンは ${recent.createdAt.toISOString().slice(0, 10)} に「${recent.detail}」を実施済みです。学習リセットを防ぐため14日間は追加変更をブロックしています（運用チェックでガードを「警告のみ」に変更すれば実行できます）。`,
        },
        { status: 409 }
      );
    }
  }

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

  // 変更ログへ自動起票（14日後に効果を自動検証）
  if (wantStatus)
    await logChange({
      organizationId: ctx.organizationId,
      connectionId: campaign.connectionId,
      campaignId: id,
      kind: "status",
      detail: `「${campaign.name}」を${wantStatus === "active" ? "配信再開" : "停止"}`,
    });
  if (wantBudget)
    await logChange({
      organizationId: ctx.organizationId,
      connectionId: campaign.connectionId,
      campaignId: id,
      kind: "dailyBudget",
      detail: `「${campaign.name}」日予算 ${campaign.dailyBudgetYen ? `¥${campaign.dailyBudgetYen.toLocaleString()}` : "未設定"} → ¥${wantBudget.toLocaleString()}`,
    });

  return Response.json({ campaign: updated });
}
