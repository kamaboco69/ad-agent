import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { generateInsight, aiConfigured } from "@/lib/insights";

export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const insights = await prisma.insight.findMany({
    where: { organizationId: ctx.organizationId, status: { not: "dismissed" } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return Response.json({ insights, aiConfigured: aiConfigured() });
}

// AIレポートの生成（手動トリガー）
export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const body = (await req.json().catch(() => ({}))) as { days?: number };
  const days = body.days === 7 || body.days === 90 ? body.days : 30;

  try {
    const insight = await generateInsight(ctx.organizationId, { days, source: "manual" });
    return Response.json({ insight });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "生成に失敗しました" }, { status: 500 });
  }
}
