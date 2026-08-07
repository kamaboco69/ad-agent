import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { decodeCsv, parseCsv, guessColumns, importLeads, type ColumnMap } from "@/lib/leads";

const MAX_BYTES = 8 * 1024 * 1024;

// GET: リード一覧（フィルタ＋ページネーション）
export async function GET(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();

  const sp = new URL(req.url).searchParams;
  const validity = sp.get("validity");
  const stage = sp.get("stage");
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const perPage = 50;

  const where = {
    organizationId: ctx.organizationId,
    ...(validity === "valid" || validity === "invalid" || validity === "unknown" ? { validity } : {}),
    ...(stage === "lead" || stage === "mql" || stage === "meeting" || stage === "won" ? { stage } : {}),
  };

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { leadAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true, email: true, companyName: true, personName: true, memo: true,
        validity: true, invalidReason: true, stage: true, lost: true, overridden: true,
        dealAmountYen: true, leadAt: true, campaignNameRaw: true, gclid: true,
        campaign: { select: { name: true } },
      },
    }),
    prisma.lead.count({ where }),
  ]);

  return Response.json({ leads, total, page, perPage });
}

// POST: CSVインポート。?preview=1 ならパース結果とカラム推測のみ返す（DB書き込みなし）
export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return Response.json({ error: "CSVファイルを添付してください" }, { status: 400 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "CSVファイルが見つかりません" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "ファイルサイズは8MBまでです" }, { status: 400 });
  }

  const text = decodeCsv(Buffer.from(await file.arrayBuffer()));
  const { headers, rows } = parseCsv(text);
  if (headers.length === 0 || rows.length === 0) {
    return Response.json({ error: "CSVを読み取れませんでした（1行目がヘッダ行になっているか確認してください）" }, { status: 400 });
  }

  const preview = new URL(req.url).searchParams.get("preview") === "1";
  if (preview) {
    return Response.json({
      headers,
      guessed: guessColumns(headers),
      sample: rows.slice(0, 5),
      totalRows: rows.length,
    });
  }

  const mapRaw = form?.get("columnMap");
  let map: ColumnMap;
  try {
    map = typeof mapRaw === "string" && mapRaw ? (JSON.parse(mapRaw) as ColumnMap) : guessColumns(headers);
  } catch {
    return Response.json({ error: "カラム対応の指定が不正です" }, { status: 400 });
  }

  try {
    const result = await importLeads(ctx.organizationId, rows, map);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "取込に失敗しました" }, { status: 500 });
  }
}
