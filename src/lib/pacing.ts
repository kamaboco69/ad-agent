// 予算の進捗管理。月予算に対する着地予想と、残りをならすための日予算目安を出す。
// 単純な線形按分ではなく直近の実消化ペースを使う（曜日変動・入札変更の影響を拾うため）。

export interface PacingInput {
  monthlyBudgetYen: number | null;
  // 当月1日から昨日までの日次消化（日付昇順）
  mtdDaily: { date: Date; costYen: number }[];
  now?: Date;
}

export type PacingStatus = "over" | "under" | "ontrack" | "nobudget";

export interface Pacing {
  status: PacingStatus;
  monthlyBudgetYen: number | null;
  mtdYen: number; // 当月ここまでの消化
  daysElapsed: number; // 経過日数（昨日まで）
  daysRemaining: number; // 今日を含む残日数
  daysInMonth: number;
  recentAvgDaily: number; // 直近7日の平均日次消化
  forecastYen: number; // 月末の着地予想
  forecastRate: number | null; // 月予算に対する着地予想の割合
  recommendedDailyYen: number | null; // 残予算をならすための日予算目安
  paceRate: number | null; // 日割り目安に対する現在の消化ペース
}

const JST = 9 * 3600_000;

export function computePacing({ monthlyBudgetYen, mtdDaily, now = new Date() }: PacingInput): Pacing {
  const jst = new Date(now.getTime() + JST);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const today = jst.getUTCDate();
  // 実績は前日までしか確定しないため、経過日数は「昨日まで」で数える
  const daysElapsed = Math.max(0, today - 1);
  const daysRemaining = daysInMonth - daysElapsed;

  const mtdYen = mtdDaily.reduce((n, d) => n + d.costYen, 0);
  const recent = mtdDaily.slice(-7);
  const recentAvgDaily = recent.length > 0 ? recent.reduce((n, d) => n + d.costYen, 0) / recent.length : 0;

  // 着地予想: ここまでの実績 ＋ 直近ペース × 残日数
  const forecastYen = Math.round(mtdYen + recentAvgDaily * daysRemaining);

  if (!monthlyBudgetYen) {
    return {
      status: "nobudget",
      monthlyBudgetYen: null,
      mtdYen,
      daysElapsed,
      daysRemaining,
      daysInMonth,
      recentAvgDaily: Math.round(recentAvgDaily),
      forecastYen,
      forecastRate: null,
      recommendedDailyYen: null,
      paceRate: null,
    };
  }

  const forecastRate = forecastYen / monthlyBudgetYen;
  const recommendedDailyYen = daysRemaining > 0 ? Math.max(0, Math.round((monthlyBudgetYen - mtdYen) / daysRemaining)) : 0;
  const expected = (monthlyBudgetYen / daysInMonth) * daysElapsed;
  const paceRate = expected > 0 ? mtdYen / expected : null;

  return {
    status: forecastRate > 1.1 ? "over" : forecastRate < 0.9 ? "under" : "ontrack",
    monthlyBudgetYen,
    mtdYen,
    daysElapsed,
    daysRemaining,
    daysInMonth,
    recentAvgDaily: Math.round(recentAvgDaily),
    forecastYen,
    forecastRate,
    recommendedDailyYen,
    paceRate,
  };
}

export const PACING_LABEL: Record<PacingStatus, string> = {
  over: "超過見込み",
  under: "未達見込み",
  ontrack: "適正",
  nobudget: "月予算未設定",
};
