import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { provisionOrganizationForUser } from "@/lib/seed-org";
import { authConfig } from "@/auth.config";

// 外部プロバイダーは環境変数が揃っている場合のみ有効化する
const providers = [];
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: true,
    })
  );
}
providers.push(
  Credentials({
    name: "credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(creds) {
      const email = (creds?.email as string | undefined)?.toLowerCase().trim();
      const password = creds?.password as string | undefined;
      if (!email || !password) return null;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user?.passwordHash) return null;

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return null;

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      };
    },
  })
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      // organizationId / role をトークンに載せる（未解決ならDB照会）
      if (token.uid && !token.organizationId) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.uid as string },
          select: { organizationId: true, role: true },
        });
        if (dbUser?.organizationId) {
          token.organizationId = dbUser.organizationId;
          token.role = dbUser.role;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid as string;
        session.user.organizationId = (token.organizationId as string | undefined) ?? null;
        session.user.role = (token.role as string | undefined) ?? "user";
      }
      return session;
    },
  },
  events: {
    // Google OAuth などで新規ユーザーが作られたら組織を自動プロビジョニング
    async createUser({ user }) {
      if (user.id) {
        await provisionOrganizationForUser(user.id, user.name ?? user.email);
      }
    },
  },
});
