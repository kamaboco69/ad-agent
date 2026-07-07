<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Ad Agent

主要広告媒体（Google / Yahoo! / Meta / Instagram / X / TikTok）の統合管理システム。
構成は x-step / ig-agent を踏襲: Next.js 16 + Prisma 7 (Neon Postgres) + NextAuth v5 マルチテナント。

- スキーマ変更は `npx prisma db push`（migrate dev は使わない。本番DB直結）
- 媒体アダプタは `src/lib/providers/`。実APIは env の資格情報が揃った媒体のみ有効、未設定はデモ接続（決定的な擬似データ）
- 全データは organizationId でスコープ。認可は `requireOrg` / `getOrgContext`（src/lib/auth-helpers.ts）
