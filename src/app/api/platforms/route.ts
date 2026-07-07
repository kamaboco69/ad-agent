import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { PLATFORM_IDS, PLATFORMS } from "@/lib/platforms";
import { apiConnectAvailable } from "@/lib/providers";

// 媒体一覧（接続状態つき）。設定画面・接続パネルで使用。
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();

  const connections = await prisma.adConnection.findMany({
    where: { organizationId: ctx.organizationId },
    select: {
      id: true,
      platform: true,
      mode: true,
      status: true,
      accountName: true,
      externalAccountId: true,
      monthlyBudgetYen: true,
      lastSyncedAt: true,
      lastError: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const platforms = PLATFORM_IDS.map((id) => ({
    id,
    label: PLATFORMS[id].label,
    short: PLATFORMS[id].short,
    color: PLATFORMS[id].color,
    apiName: PLATFORMS[id].apiName,
    note: PLATFORMS[id].note,
    apiAvailable: apiConnectAvailable(id),
    connections: connections.filter((c) => c.platform === id),
  }));

  return Response.json({ platforms });
}
