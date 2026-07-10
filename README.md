# Ad Agent

主要広告媒体を**ひとつのダッシュボード**で管理する広告運用システム。
対応媒体: **Google 広告 / Yahoo!広告 / Meta（Facebook）/ Instagram / X / TikTok**

構成は x-step / ig-agent を踏襲: Next.js 16 + Prisma 7 (Neon Postgres) + NextAuth v5 + Firebase App Hosting。

## できること（v1）

- **媒体接続の一元管理** — 媒体ごとに「実API接続（OAuth）」または「デモ接続」
  - 実API: env に資格情報を設定した媒体のみ有効（トークンは AES-256-GCM で暗号化保存）
  - デモ: 資格情報なしで全機能を試せる決定的な擬似データ（接続IDがシードなので同期しても同じ実績）
- **統合ダッシュボード** — 消化額 / IMP / Click / CTR / CPC / CV / CPA / ROAS を媒体横断で集計
  - 日別消化額のトレンドチャート（媒体別・ホバーで内訳）
  - 媒体別パフォーマンステーブル、期間切替（7 / 30 / 90日）
- **キャンペーン管理** — 配信/停止の切替・日予算の変更（API接続時は媒体へ即時反映）
- **AI インサイト** — Claude（claude-opus-4-8）が実績を分析し、予算再配分などの改善提案を日本語 Markdown で生成
- **予算アラート** — 接続ごとに月予算を設定 → cron が消化ペースを監視し、超過見込みでアラート

## 実API対応状況

| 媒体 | OAuth | 実績同期 | 操作（停止/予算） | 前提 |
|---|---|---|---|---|
| Google 広告 | ✅ | ✅ GAQL | ✅ mutate | 開発者トークン（Basic access）承認 |
| Meta / Instagram | ✅ | ✅ insights（IGは publisher_platform 絞り込み） | ✅ | ads_read / ads_management のアプリレビュー |
| TikTok | ✅ | ✅ report/integrated | ✅ | TikTok for Business アプリ審査 |
| Yahoo!広告 | ✅ | 🚧 承認後に実装（非同期レポートAPI） | 🚧 | API利用申請の審査 |
| X | 🚧 承認後に実装（OAuth 1.0a） | 🚧 | 🚧 | Ads API アクセス申請 |

未対応・未設定の媒体はデモ接続で運用フローを検証できる。

## セットアップ

```bash
npm install
cp .env.example .env   # 値を設定
npx prisma db push     # スキーマ反映（migrate dev は使わない）
npm run dev
```

テストユーザー作成（任意）: `npx tsx scripts/create-test-user.ts`（demo@adagent.local / demo-pass-1234）

## cron（Cloud Scheduler）

デプロイ後、以下を1日1〜2回叩く:

```
GET https://<本番ドメイン>/api/cron?task=all
Authorization: Bearer <CRON_SECRET>
```

- `task=sync` … 全接続の実績同期（直近14日を上書き取得）
- `task=alerts` … 月予算の消化ペース監視（超過見込みでアラート生成）
- `task=insights` … 週次AI改善レポートの自動生成（毎週月曜JSTのみ。`&force=1` で即時生成）

## デプロイ（Firebase App Hosting）

ig-agent と同じ手順。`apphosting.yaml` の `ADAGENT_*` シークレットを設定して backend を作成し、
`firebase apphosting:rollouts:create` でロールアウトする。DB は Neon の同一ホスト上の `adagent` データベース。
