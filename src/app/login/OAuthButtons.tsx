"use client";

import { signIn } from "next-auth/react";

// 有効な外部プロバイダーのログインボタンを表示する。無効なら何も描画しない。
export function OAuthButtons({
  google,
  callbackUrl = "/",
}: {
  google: boolean;
  callbackUrl?: string;
}) {
  if (!google) return null;

  return (
    <>
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl })}
          className="w-full flex items-center justify-center gap-2 bg-white text-gray-800 font-medium rounded-lg py-2.5 hover:bg-gray-100 transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 4.75 12 4.75z"/>
          </svg>
          Googleで続ける
        </button>
      </div>
      <div className="flex items-center gap-3 my-4">
        <div className="flex-1 h-px bg-neutral-900" />
        <span className="text-gray-600 text-xs">または</span>
        <div className="flex-1 h-px bg-neutral-900" />
      </div>
    </>
  );
}
