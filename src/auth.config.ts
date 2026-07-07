import type { NextAuthConfig } from "next-auth";

// middleware（edge runtime）でも安全に使える最小設定。
// Prisma / bcrypt などNode専用APIはここに置かない。
export const authConfig = {
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [], // 実際のプロバイダーは auth.ts 側で追加（Node runtime）
  callbacks: {
    // middleware からのルート保護判定に使う
    authorized({ auth }) {
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
