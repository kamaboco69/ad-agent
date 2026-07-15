import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { syncConnection, DEFAULT_SYNC_DAYS } from "@/lib/sync";
import { logChange } from "@/lib/rules";

// 接続設定の更新（月予算・表示名・接続アカウントの変更）
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { id } = await params;

  const conn = await prisma.adConnection.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!conn) return Response.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    monthlyBudgetYen?: number | null;
    accountName?: string;
    externalAccountId?: string;
    loginCustomerId?: string | null;
    autoExclude?: boolean;
    targetCpaYen?: number | null;
    targetRoas?: number | null;
  };

  // 接続アカウントの変更（実API接続のみ）: 対象を切り替え、旧アカウントのデータを消して再同期
  if (typeof body.externalAccountId === "string" && body.externalAccountId.trim()) {
    if (conn.mode !== "api") {
      return Response.json({ error: "デモ接続ではアカウントを変更できません" }, { status: 400 });
    }
    const newAccount = body.externalAccountId.trim();
    const newLogin =
      typeof body.loginCustomerId === "string" && body.loginCustomerId.trim() ? body.loginCustomerId.trim() : null;
    const newName =
      typeof body.accountName === "string" && body.accountName.trim() ? body.accountName.trim() : conn.accountName;

    const updated = await prisma.adConnection.update({
      where: { id },
      data: { externalAccountId: newAccount, loginCustomerId: newLogin, accountName: newName, status: "connected", lastError: null },
    });
    // 旧アカウントのキャンペーン/実績/検索語句を削除（DailyMetric はカスケード削除）してから再同期
    await prisma.campaign.deleteMany({ where: { connectionId: id } });
    await prisma.searchTerm.deleteMany({ where: { connectionId: id } });
    const outcome = await syncConnection(updated, DEFAULT_SYNC_DAYS);
    return Response.json({ connection: { id: updated.id, externalAccountId: updated.externalAccountId }, sync: outcome });
  }

  const data: Record<string, unknown> = {};
  if (body.monthlyBudgetYen === null) data.monthlyBudgetYen = null;
  if (typeof body.monthlyBudgetYen === "number" && body.monthlyBudgetYen >= 0) {
    data.monthlyBudgetYen = Math.round(body.monthlyBudgetYen);
  }
  if (typeof body.accountName === "string" && body.accountName.trim()) {
    data.accountName = body.accountName.trim();
  }
  if (typeof body.autoExclude === "boolean") data.autoExclude = body.autoExclude;
  if (body.targetCpaYen === null) data.targetCpaYen = null;
  if (typeof body.targetCpaYen === "number" && body.targetCpaYen > 0) data.targetCpaYen = Math.round(body.targetCpaYen);
  if (body.targetRoas === null) data.targetRoas = null;
  if (typeof body.targetRoas === "number" && body.targetRoas > 0) data.targetRoas = Math.round(body.targetRoas);
  if (Object.keys(data).length === 0) return Response.json({ error: "変更内容がありません" }, { status: 400 });

  const updated = await prisma.adConnection.update({ where: { id }, data });

  // 変更ログへ自動起票（運用ルール§0。表示名変更・自動除外トグルは対象外）
  const yen = (v: number | null | undefined) => (v ? `¥${v.toLocaleString()}` : "未設定");
  const logs: Array<{ kind: string; detail: string }> = [];
  if ("monthlyBudgetYen" in data)
    logs.push({ kind: "monthlyBudget", detail: `月予算 ${yen(conn.monthlyBudgetYen)} → ${yen(updated.monthlyBudgetYen)}` });
  if ("targetCpaYen" in data)
    logs.push({ kind: "target", detail: `目標CPA ${yen(conn.targetCpaYen)} → ${yen(updated.targetCpaYen)}` });
  if ("targetRoas" in data)
    logs.push({
      kind: "target",
      detail: `目標ROAS ${conn.targetRoas ? conn.targetRoas + "%" : "未設定"} → ${updated.targetRoas ? updated.targetRoas + "%" : "未設定"}`,
    });
  for (const l of logs) {
    await logChange({ organizationId: ctx.organizationId, connectionId: id, ...l });
  }

  return Response.json({ connection: { id: updated.id, monthlyBudgetYen: updated.monthlyBudgetYen } });
}

// 接続解除（キャンペーン・実績もカスケード削除）
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { id } = await params;

  const conn = await prisma.adConnection.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!conn) return Response.json({ error: "not found" }, { status: 404 });

  await prisma.adConnection.delete({ where: { id } });
  return Response.json({ ok: true });
}
