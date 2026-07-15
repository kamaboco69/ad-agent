import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { getProvider } from "@/lib/providers";
import { toProviderConnection } from "@/lib/sync";
import { logChange } from "@/lib/rules";

// POST: 検索語句を完全一致キーワードとして正式登録（昇格・手順書§2-A）
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { id } = await params;

  const conn = await prisma.adConnection.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!conn) return Response.json({ error: "not found" }, { status: 404 });
  if (conn.mode !== "api") return Response.json({ error: "デモ接続では昇格はできません" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { campaignExternalId?: string; term?: string };
  const { campaignExternalId, term } = body;
  if (!campaignExternalId || !term) {
    return Response.json({ error: "campaignExternalId と term は必須です" }, { status: 400 });
  }

  const pconn = toProviderConnection(conn);
  const provider = getProvider(pconn.platform, "api");
  if (!provider.addKeyword) {
    return Response.json({ error: "この媒体はキーワード昇格に対応していません" }, { status: 400 });
  }

  try {
    await provider.addKeyword(pconn, campaignExternalId, term);
    await prisma.searchTerm.updateMany({
      where: { connectionId: id, campaignExternalId, term },
      data: { status: "promoted" },
    });
    await logChange({
      organizationId: ctx.organizationId,
      connectionId: id,
      kind: "promote",
      detail: `昇格KW「${term}」（完全一致で登録）`,
    });
    return Response.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: message }, { status: 502 });
  }
}
