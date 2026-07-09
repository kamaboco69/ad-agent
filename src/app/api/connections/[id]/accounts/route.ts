import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { getProvider } from "@/lib/providers";
import { toProviderConnection } from "@/lib/sync";

// 実API接続で選択可能なアカウント一覧（Google Ads の複数アカウント/MCC配下）を返す。
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { id } = await params;

  const conn = await prisma.adConnection.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!conn) return Response.json({ error: "not found" }, { status: 404 });
  if (conn.mode !== "api") {
    return Response.json({ error: "デモ接続ではアカウント選択はできません" }, { status: 400 });
  }

  const pconn = toProviderConnection(conn);
  const provider = getProvider(pconn.platform, "api");
  if (!provider.listAccounts) {
    return Response.json({ error: "この媒体はアカウント選択に対応していません" }, { status: 400 });
  }

  try {
    const accounts = await provider.listAccounts(pconn);
    return Response.json({ accounts });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: message }, { status: 502 });
  }
}
