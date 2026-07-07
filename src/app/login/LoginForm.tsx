"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { OAuthButtons } from "./OAuthButtons";

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params?.get("callbackUrl") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      setError("メールアドレスまたはパスワードが正しくありません");
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <div className="inline-flex w-12 h-12 rounded-xl bg-gradient-to-tr from-sky-600 via-cyan-500 to-emerald-400 items-center justify-center text-white text-xl font-black mb-3">
          AD
        </div>
        <h1 className="text-2xl font-bold text-white">おかえりなさい</h1>
        <p className="text-gray-400 text-sm mt-1">Ad Agent にログイン</p>
      </div>

      <OAuthButtons google={googleEnabled} callbackUrl={callbackUrl} />

      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label className="block text-gray-400 text-xs mb-1.5">メールアドレス</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-neutral-950 border border-neutral-700 focus:border-sky-500 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="block text-gray-400 text-xs mb-1.5">パスワード</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-neutral-950 border border-neutral-700 focus:border-sky-500 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none"
            placeholder="••••••••"
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-medium rounded-lg py-2.5 transition-colors"
        >
          {loading && <Loader2 size={16} className="animate-spin" />}
          ログイン
        </button>
      </form>

      <p className="text-center text-gray-500 text-sm mt-6">
        アカウントをお持ちでない方は{" "}
        <Link href="/signup" className="text-sky-400 hover:underline">
          新規登録
        </Link>
      </p>
    </div>
  );
}
