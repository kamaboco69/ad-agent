import { Suspense } from "react";
import Link from "next/link";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const googleEnabled = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center px-4 bg-black">
      <Suspense fallback={null}>
        <LoginForm googleEnabled={googleEnabled} />
      </Suspense>
      <footer className="absolute bottom-4 left-0 right-0 text-center text-xs text-gray-600">
        <Link href="/privacy" className="hover:text-gray-400">
          プライバシーポリシー
        </Link>
        <span className="mx-2">·</span>
        <Link href="/terms" className="hover:text-gray-400">
          利用規約
        </Link>
      </footer>
    </div>
  );
}
