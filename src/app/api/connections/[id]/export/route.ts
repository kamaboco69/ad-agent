import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { buildExportData, buildXlsx, buildPptx } from "@/lib/export";

// GET: クライアント提出用の Excel / PowerPoint をダウンロードする
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { id } = await params;

  const conn = await prisma.adConnection.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, accountName: true },
  });
  if (!conn) return Response.json({ error: "not found" }, { status: 404 });

  const sp = new URL(req.url).searchParams;
  const format = sp.get("format") === "pptx" ? "pptx" : "xlsx";
  const days = Number(sp.get("days")) || 30;

  try {
    const data = await buildExportData(ctx.organizationId, id, days);
    const buf = format === "pptx" ? await buildPptx(data) : await buildXlsx(data);
    const stamp = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    // 日本語ファイル名は RFC 5987 でエンコードして渡す
    const name = `${data.clientName}_広告レポート_${stamp}.${format}`;
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          format === "pptx"
            ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="report.${format}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "生成に失敗しました" }, { status: 500 });
  }
}
