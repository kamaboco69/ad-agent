import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { syncCreatives, analyzeCreatives } from "@/lib/creatives";

// POST: 広告アセットの同期（?analyze=1 なら同期後にAI分析まで実行）
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { id } = await params;

  const conn = await prisma.adConnection.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!conn) return Response.json({ error: "not found" }, { status: 404 });
  if (conn.mode !== "api") {
    return Response.json({ error: "デモ接続では広告アセット分析は使えません" }, { status: 400 });
  }

  const analyze = new URL(req.url).searchParams.get("analyze") === "1";
  try {
    if (analyze) {
      const result = await analyzeCreatives(id);
      return Response.json(result);
    }
    const result = await syncCreatives(conn);
    return Response.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: message }, { status: 502 });
  }
}
