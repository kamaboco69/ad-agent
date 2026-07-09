import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "利用規約 | Ad Agent",
  description: "Ad Agent の利用規約。",
};

const UPDATED = "2026年7月10日";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-black text-gray-100">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-8">
          <Link href="/login" className="text-sm text-gray-400 hover:text-gray-200">
            ← Ad Agent
          </Link>
        </div>

        <h1 className="text-2xl font-bold">利用規約</h1>
        <p className="mt-2 text-sm text-gray-400">最終更新日: {UPDATED}</p>

        <div className="mt-8 space-y-8 text-sm leading-7 text-gray-300">
          <section>
            <h2 className="text-lg font-semibold text-gray-100">1. サービス内容</h2>
            <p className="mt-3">
              Ad Agent（以下「本サービス」）は、複数の広告プラットフォーム（Google 広告・Yahoo!広告・Meta・
              Instagram・X・TikTok）のアカウントを連携し、実績の集計・可視化、およびキャンペーンの管理を行う
              ダッシュボードサービスです。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-100">2. アカウント連携</h2>
            <p className="mt-3">
              利用者は、各プラットフォームの OAuth 認可を通じて自身の広告アカウントを本サービスに連携できます。
              利用者は、連携するアカウントについて必要な権限を有していることを表明するものとします。連携はいつでも
              解除できます。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-100">3. 禁止事項</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>各広告プラットフォームの規約・ポリシーに違反する行為</li>
              <li>権限のないアカウントへのアクセスを試みる行為</li>
              <li>本サービスの運営を妨害する行為</li>
              <li>法令に違反する行為</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-100">4. 免責</h2>
            <p className="mt-3">
              本サービスは、広告実績データの取得や表示、キャンペーン操作の反映について、各プラットフォームの API の
              仕様変更・障害等により正確性や可用性を完全に保証するものではありません。本サービスの利用により生じた
              損害について、法令で認められる範囲で責任を負わないものとします。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-100">5. 規約の変更</h2>
            <p className="mt-3">
              本サービスは、必要に応じて本規約を変更することがあります。変更後の規約は本ページに掲示した時点で
              効力を生じます。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-100">6. お問い合わせ</h2>
            <p className="mt-3">
              本規約に関するお問い合わせは{" "}
              <a href="mailto:n-ikeda@g-ism.jp" className="text-indigo-400 underline hover:text-indigo-300">
                n-ikeda@g-ism.jp
              </a>{" "}
              までご連絡ください。
            </p>
          </section>
        </div>

        <div className="mt-12 border-t border-gray-800 pt-6 text-sm text-gray-500">
          <Link href="/privacy" className="hover:text-gray-300">
            プライバシーポリシー
          </Link>
        </div>
      </div>
    </main>
  );
}
