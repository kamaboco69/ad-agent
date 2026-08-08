import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { suggestOneAsset } from "@/lib/creatives";

// POST: アセット1件だけ改善案を出す（一覧の「改善」ボタン用）
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as { assetId?: string };
  if (!body.assetId) return Response.json({ error: "対象を指定してください" }, { status: 400 });

  const asset = await prisma.adAsset.findFirst({
    where: { id: body.assetId, organizationId: ctx.organizationId, connectionId: id },
    select: { id: true },
  });
  if (!asset) return Response.json({ error: "対象のアセットが見つかりません" }, { status: 404 });

  try {
    return Response.json(await suggestOneAsset(body.assetId));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 502 });
  }
}
