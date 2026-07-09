import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "プライバシーポリシー | Ad Agent",
  description: "Ad Agent のプライバシーポリシー。取得する情報、Google API から取得したデータの利用、保管とセキュリティについて説明します。",
};

const UPDATED = "2026年7月10日";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-black text-gray-100">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-8">
          <Link href="/login" className="text-sm text-gray-400 hover:text-gray-200">
            ← Ad Agent
          </Link>
        </div>

        <h1 className="text-2xl font-bold">プライバシーポリシー</h1>
        <p className="mt-2 text-sm text-gray-400">最終更新日: {UPDATED}</p>

        <div className="mt-8 space-y-8 text-sm leading-7 text-gray-300">
          <section>
            <p>
              Ad Agent（以下「本サービス」）は、Google 広告・Yahoo!広告・Meta（Facebook / Instagram）・X・TikTok
              などの広告アカウントを、ひとつのダッシュボードで管理・分析するためのサービスです。本ポリシーは、
              本サービスが取得する情報とその取り扱いについて説明します。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-100">1. 取得する情報</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>アカウント情報（氏名・メールアドレスなど、ログインおよび連絡のために取得する情報）</li>
              <li>
                広告アカウントの連携情報（利用者が OAuth により許可した各広告プラットフォームのアクセストークン・
                リフレッシュトークン、および連携対象のアカウント ID）
              </li>
              <li>
                広告実績データ（キャンペーン名・ステータス・予算、表示回数・クリック・費用・コンバージョンなどの
                指標。各プラットフォームの API を通じて取得します）
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-100">2. 情報の利用目的</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>広告実績を集計・可視化したダッシュボードおよびレポートの提供</li>
              <li>利用者の操作に基づくキャンペーンの配信/停止・日予算の変更などの管理機能の提供</li>
              <li>予算の消化ペース監視とアラートの通知</li>
              <li>本サービスの提供・維持・改善、およびお問い合わせへの対応</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-100">3. Google API から取得したデータの取り扱い</h2>
            <p className="mt-3">
              本サービスによる Google API から受け取った情報の利用および他アプリへの提供は、
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noreferrer"
                className="text-indigo-400 underline hover:text-indigo-300"
              >
                Google API Services User Data Policy
              </a>
              （限定的使用の要件（Limited Use requirements）を含む）を遵守します。
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                Google 広告のデータ（<code className="text-gray-200">https://www.googleapis.com/auth/adwords</code>{" "}
                スコープ）は、利用者が明示的に連携を許可した広告アカウントについてのみ取得します。
              </li>
              <li>取得したデータは、上記「情報の利用目的」に記載した機能の提供のためだけに使用します。</li>
              <li>
                Google のユーザーデータを、広告目的で第三者に譲渡・販売することはありません。また、人による閲覧は、
                利用者の同意がある場合、セキュリティ目的（不正・悪用の調査等）、法令上の要請、または集計・匿名化した
                内部運用の場合を除き行いません。
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-100">4. 情報の第三者提供</h2>
            <p className="mt-3">
              本サービスは、利用者の広告データやアカウント情報を第三者に販売・貸与しません。法令に基づく場合、または
              本サービスの提供に必要なインフラ事業者（クラウドホスティング等）に対して、機能提供の範囲で委託する場合を
              除き、第三者へ提供することはありません。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-100">5. 保管とセキュリティ</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>アクセストークン・リフレッシュトークンは暗号化（AES-256-GCM）して保管します。</li>
              <li>データは組織（テナント）単位で分離し、利用者は自身が許可したアカウントの情報にのみアクセスできます。</li>
              <li>データはアクセス制御されたクラウド環境（Google Cloud）で管理されます。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-100">6. データの保持と削除</h2>
            <p className="mt-3">
              広告アカウントの連携は、本サービスの画面からいつでも解除できます。連携を解除すると、当該アカウントの
              アクセストークンおよび関連データは削除されます。アカウントの削除やデータの消去をご希望の場合は、下記
              連絡先までご連絡ください。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-100">7. 本ポリシーの変更</h2>
            <p className="mt-3">
              本サービスは、必要に応じて本ポリシーを変更することがあります。重要な変更がある場合は、本ページ上で
              告知します。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-100">8. お問い合わせ</h2>
            <p className="mt-3">
              本ポリシーに関するお問い合わせは{" "}
              <a href="mailto:n-ikeda@g-ism.jp" className="text-indigo-400 underline hover:text-indigo-300">
                n-ikeda@g-ism.jp
              </a>{" "}
              までご連絡ください。
            </p>
          </section>
        </div>

        <div className="mt-12 border-t border-gray-800 pt-6 text-sm text-gray-500">
          <Link href="/terms" className="hover:text-gray-300">
            利用規約
          </Link>
        </div>
      </div>
    </main>
  );
}
