import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { getProvider } from "@/lib/providers";
import { toProviderConnection } from "@/lib/sync";

// GET: 運用チェック（コンバージョン計測ヘルス＋直近の変更履歴＝学習期間ガード）
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { id } = await params;

  const conn = await prisma.adConnection.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!conn) return Response.json({ error: "not found" }, { status: 404 });
  if (conn.mode !== "api") {
    return Response.json({ error: "デモ接続では運用チェックは使えません" }, { status: 400 });
  }

  const pconn = toProviderConnection(conn);
  const provider = getProvider(pconn.platform, "api");
  if (!provider.conversionHealth || !provider.recentChanges) {
    return Response.json({ error: "この媒体は運用チェックに対応していません" }, { status: 400 });
  }

  try {
    const [health, changes] = await Promise.all([
      provider.conversionHealth(pconn),
      provider.recentChanges(pconn, 7),
    ]);
    return Response.json({ health, changes });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: message }, { status: 502 });
  }
}
