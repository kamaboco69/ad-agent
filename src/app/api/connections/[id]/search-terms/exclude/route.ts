import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { getProvider } from "@/lib/providers";
import { toProviderConnection } from "@/lib/sync";
import { logChange } from "@/lib/rules";

// POST: 検索語句をキャンペーンの除外キーワードとして媒体に登録し、状態を excluded にする
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { id } = await params;

  const conn = await prisma.adConnection.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!conn) return Response.json({ error: "not found" }, { status: 404 });
  if (conn.mode !== "api") {
    return Response.json({ error: "デモ接続では除外登録はできません" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    campaignExternalId?: string;
    term?: string;
    matchType?: string;
  };
  const { campaignExternalId, term } = body;
  const matchType = body.matchType === "PHRASE" ? "PHRASE" : "EXACT";
  if (!campaignExternalId || !term) {
    return Response.json({ error: "campaignExternalId と term は必須です" }, { status: 400 });
  }

  const pconn = toProviderConnection(conn);
  const provider = getProvider(pconn.platform, "api");
  if (!provider.addNegativeKeyword) {
    return Response.json({ error: "この媒体は除外キーワード登録に対応していません" }, { status: 400 });
  }

  try {
    await provider.addNegativeKeyword(pconn, campaignExternalId, term, matchType);
    await prisma.searchTerm.updateMany({
      where: { connectionId: id, campaignExternalId, term },
      data: { status: "excluded" },
    });
    await logChange({
      organizationId: ctx.organizationId,
      connectionId: id,
      kind: "exclude",
      detail: `除外KW「${term}」`,
    });
    return Response.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: message }, { status: 502 });
  }
}
