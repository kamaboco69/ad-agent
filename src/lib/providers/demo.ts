import type { PlatformId } from "@/lib/platforms";
import type {
  AdProvider,
  ProviderCampaign,
  ProviderConnection,
  ProviderDailyMetric,
  SyncResult,
} from "./types";
import { lastDatesJst } from "./types";

// デモ接続用のデータ生成。接続IDをシードにした決定的な擬似乱数で、
// 同じ接続なら何度同期しても同じ実績になる（日付が進んだ分だけ増える）。

function hashSeed(s: string): number {
  let h = 1779033703;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface CampaignTemplate {
  name: string;
  objective: string;
  dailyBudgetYen: number;
  ctr: number; // クリック率
  cpcYen: number; // 平均クリック単価
  cvr: number; // コンバージョン率
  aovYen: number; // 平均注文額（ROAS計算用。0ならCV価値なし＝リード等）
}

const TEMPLATES: Record<PlatformId, CampaignTemplate[]> = {
  google: [
    { name: "【検索】指名キーワード", objective: "sales", dailyBudgetYen: 5000, ctr: 0.12, cpcYen: 45, cvr: 0.08, aovYen: 9800 },
    { name: "【検索】一般キーワード", objective: "sales", dailyBudgetYen: 12000, ctr: 0.045, cpcYen: 120, cvr: 0.021, aovYen: 9800 },
    { name: "【P-MAX】主力商品フィード", objective: "sales", dailyBudgetYen: 15000, ctr: 0.018, cpcYen: 60, cvr: 0.015, aovYen: 8200 },
  ],
  yahoo: [
    { name: "【検索】指名キーワード", objective: "sales", dailyBudgetYen: 3000, ctr: 0.10, cpcYen: 40, cvr: 0.07, aovYen: 9800 },
    { name: "【ディスプレイ】リターゲティング", objective: "sales", dailyBudgetYen: 6000, ctr: 0.006, cpcYen: 35, cvr: 0.012, aovYen: 8500 },
  ],
  meta: [
    { name: "【CV】リターゲティング", objective: "sales", dailyBudgetYen: 8000, ctr: 0.015, cpcYen: 80, cvr: 0.028, aovYen: 8800 },
    { name: "【CV】類似オーディエンス1%", objective: "sales", dailyBudgetYen: 10000, ctr: 0.011, cpcYen: 95, cvr: 0.014, aovYen: 8800 },
    { name: "【認知】新規リーチ拡大", objective: "awareness", dailyBudgetYen: 4000, ctr: 0.008, cpcYen: 50, cvr: 0.002, aovYen: 0 },
  ],
  instagram: [
    { name: "【CV】ストーリーズ縦型動画", objective: "sales", dailyBudgetYen: 7000, ctr: 0.013, cpcYen: 85, cvr: 0.018, aovYen: 7600 },
    { name: "【トラフィック】フィード静止画", objective: "traffic", dailyBudgetYen: 4000, ctr: 0.016, cpcYen: 55, cvr: 0.006, aovYen: 7600 },
  ],
  x: [
    { name: "【CV】キーワードターゲティング", objective: "sales", dailyBudgetYen: 5000, ctr: 0.009, cpcYen: 70, cvr: 0.009, aovYen: 8000 },
    { name: "【フォロワー】アカウント成長", objective: "awareness", dailyBudgetYen: 3000, ctr: 0.007, cpcYen: 90, cvr: 0.001, aovYen: 0 },
  ],
  tiktok: [
    { name: "【CV】スパーク広告", objective: "sales", dailyBudgetYen: 9000, ctr: 0.014, cpcYen: 65, cvr: 0.012, aovYen: 6800 },
    { name: "【リーチ】インフィード動画", objective: "awareness", dailyBudgetYen: 5000, ctr: 0.010, cpcYen: 40, cvr: 0.002, aovYen: 0 },
  ],
  line: [
    { name: "【CV】ウェブサイトコンバージョン", objective: "sales", dailyBudgetYen: 8000, ctr: 0.008, cpcYen: 55, cvr: 0.015, aovYen: 8500 },
    { name: "【友だち追加】CPF配信", objective: "leads", dailyBudgetYen: 5000, ctr: 0.011, cpcYen: 75, cvr: 0.04, aovYen: 0 },
    { name: "【認知】トークリスト面リーチ", objective: "awareness", dailyBudgetYen: 3000, ctr: 0.006, cpcYen: 45, cvr: 0.001, aovYen: 0 },
  ],
};

// 曜日係数（JSTの土日はECが伸びる想定の緩い季節性）
const DOW_FACTOR = [1.08, 0.95, 0.93, 0.96, 0.98, 1.02, 1.1]; // Sun..Sat

export function demoAccountName(platform: PlatformId): string {
  const names: Record<PlatformId, string> = {
    google: "デモアカウント（Google）",
    yahoo: "デモアカウント（Yahoo!）",
    meta: "デモアカウント（Meta）",
    instagram: "デモアカウント（Instagram）",
    x: "デモアカウント（X）",
    tiktok: "デモアカウント（TikTok）",
    line: "デモアカウント（LINE）",
  };
  return names[platform];
}

export function generateDemoSync(conn: ProviderConnection, days: number): SyncResult {
  const templates = TEMPLATES[conn.platform];
  const campaigns: ProviderCampaign[] = templates.map((t, i) => ({
    externalId: `demo-${conn.platform}-${i + 1}`,
    name: t.name,
    status: "active",
    objective: t.objective,
    dailyBudgetYen: t.dailyBudgetYen,
  }));

  const metrics: ProviderDailyMetric[] = [];
  const dates = lastDatesJst(days);

  templates.forEach((t, i) => {
    const externalId = campaigns[i].externalId;
    dates.forEach((date) => {
      const rand = mulberry32(hashSeed(`${conn.id}:${externalId}:${date}`));
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      // 日予算の 75〜100% を消化。曜日係数とノイズで上下させる
      const spendFactor = (0.75 + rand() * 0.25) * DOW_FACTOR[dow];
      const costYen = Math.round(t.dailyBudgetYen * Math.min(spendFactor, 1.0));
      const cpc = t.cpcYen * (0.85 + rand() * 0.3);
      const clicks = Math.max(1, Math.round(costYen / cpc));
      const ctr = t.ctr * (0.8 + rand() * 0.4);
      const impressions = Math.round(clicks / ctr);
      const conversions = Math.round(clicks * t.cvr * (0.7 + rand() * 0.6) * 10) / 10;
      const conversionValueYen = Math.round(conversions * t.aovYen * (0.9 + rand() * 0.2));
      metrics.push({
        campaignExternalId: externalId,
        date,
        impressions,
        clicks,
        costYen,
        conversions,
        conversionValueYen,
      });
    });
  });

  return { campaigns, metrics };
}

export function createDemoProvider(platform: PlatformId): AdProvider {
  return {
    platform,
    configured: () => true,
    authUrl: () => {
      throw new Error("デモ接続に OAuth は不要です");
    },
    exchangeCode: async () => {
      throw new Error("デモ接続に OAuth は不要です");
    },
    sync: async (conn, days) => generateDemoSync(conn, days),
    // デモはDB上のステータス/予算変更のみ（API呼び出しなし）
    setCampaignStatus: async () => {},
    setDailyBudget: async () => {},
  };
}
