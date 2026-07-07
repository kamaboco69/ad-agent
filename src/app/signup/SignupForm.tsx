"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { signupAction, type SignupState } from "./actions";
import { OAuthButtons } from "../login/OAuthButtons";

export function SignupForm({ googleEnabled }: { googleEnabled: boolean }) {
  const [state, formAction, pending] = useActionState<SignupState, FormData>(
    signupAction,
    {}
  );

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <div className="inline-flex w-12 h-12 rounded-xl bg-gradient-to-tr from-sky-600 via-cyan-500 to-emerald-400 items-center justify-center text-white text-xl font-black mb-3">
          AD
        </div>
        <h1 className="text-2xl font-bold text-white">無料ではじめる</h1>
        <p className="text-gray-400 text-sm mt-1">主要広告媒体をひとつのダッシュボードで管理</p>
      </div>

      <OAuthButtons google={googleEnabled} callbackUrl="/" />

      <form action={formAction} className="space-y-3">
        <div>
          <label className="block text-gray-400 text-xs mb-1.5">お名前（任意）</label>
          <input
            type="text"
            name="name"
            className="w-full bg-neutral-950 border border-neutral-700 focus:border-sky-500 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none"
            placeholder="山田 太郎"
          />
        </div>
        <div>
          <label className="block text-gray-400 text-xs mb-1.5">メールアドレス</label>
          <input
            type="email"
            name="email"
            required
            className="w-full bg-neutral-950 border border-neutral-700 focus:border-sky-500 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="block text-gray-400 text-xs mb-1.5">パスワード（8文字以上）</label>
          <input
            type="password"
            name="password"
            required
            minLength={8}
            className="w-full bg-neutral-950 border border-neutral-700 focus:border-sky-500 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none"
            placeholder="••••••••"
          />
        </div>

        {state.error && <p className="text-red-400 text-sm">{state.error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="w-full flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-medium rounded-lg py-2.5 transition-colors"
        >
          {pending && <Loader2 size={16} className="animate-spin" />}
          無料で登録
        </button>
      </form>

      <p className="text-center text-gray-500 text-sm mt-6">
        すでにアカウントをお持ちの方は{" "}
        <Link href="/login" className="text-sky-400 hover:underline">
          ログイン
        </Link>
      </p>
    </div>
  );
}
