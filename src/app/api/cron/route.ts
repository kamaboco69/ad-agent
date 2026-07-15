import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { syncConnection } from "@/lib/sync";
import { checkBudgetAlerts, runWeeklyInsights, runMonthlyReview } from "@/lib/insights";
import { runAutoExclude } from "@/lib/search-terms";
import { snapshotDaily, runDailyChecks, verifyDueChanges } from "@/lib/rules";

// 定期実行（Cloud Scheduler から Bearer CRON_SECRET で叩く）。
// task=sync     … 全組織の全接続の日次同期（直近14日を上書き取得）
// task=alerts   … 月予算の消化ペース監視
// task=insights … 週次AI改善レポート（毎週月曜JSTのみ生成。&force=1 で即時生成）
// task=all      … 上記すべて
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const task = new URL(req.url).searchParams.get("task") ?? "all";
  const result: Record<string, unknown> = {};

  if (task === "sync" || task === "all") {
    const connections = await prisma.adConnection.findMany({
      where: { status: { not: "revoked" } },
    });
    let ok = 0;
    let failed = 0;
    for (const conn of connections) {
      const outcome = await syncConnection(conn, 14);
      if (outcome.ok) ok++;
      else failed++;
    }
    result.sync = { total: connections.length, ok, failed };
  }

  if (task === "alerts" || task === "all") {
    const orgs = await prisma.adConnection.findMany({
      where: { monthlyBudgetYen: { not: null } },
      select: { organizationId: true },
      distinct: ["organizationId"],
    });
    let alerts = 0;
    for (const { organizationId } of orgs) {
      alerts += await checkBudgetAlerts(organizationId);
    }
    result.alerts = { created: alerts };
  }

  if (task === "insights" || task === "all") {
    const force = new URL(req.url).searchParams.get("force") === "1";
    result.insights = await runWeeklyInsights(force);
  }

  if (task === "optimize" || task === "all") {
    const force = new URL(req.url).searchParams.get("force") === "1";
    result.optimize = await runAutoExclude(force); // 毎週月曜JST・autoExclude有効な接続のみ
  }

  if (task === "monthly" || task === "all") {
    const force = new URL(req.url).searchParams.get("force") === "1";
    result.monthly = await runMonthlyReview(force); // 毎月1日JSTのみ生成
  }

  if (task === "daily" || task === "all") {
    // 日次ルール（§0/§1/§9）。異常検知は朝9時の実行のみ（21時実行では snapshot だけ更新）
    const force = new URL(req.url).searchParams.get("force") === "1";
    const isMorning = new Date(Date.now() + 9 * 3600_000).getUTCHours() < 12;
    const snapshot = await snapshotDaily();
    const checks = force || isMorning ? await runDailyChecks() : { alerts: 0 };
    const verify = force || isMorning ? await verifyDueChanges() : { verified: 0 };
    result.daily = { snapshot, ...checks, ...verify };
  }

  return Response.json({ ok: true, task, ...result });
}
