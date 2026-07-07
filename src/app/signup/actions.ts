"use server";

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { provisionOrganizationForUser } from "@/lib/seed-org";
import { signIn } from "@/auth";

export interface SignupState {
  error?: string;
}

export async function signupAction(
  _prev: SignupState,
  formData: FormData
): Promise<SignupState> {
  const name = (formData.get("name") as string | null)?.trim() || null;
  const email = (formData.get("email") as string | null)?.toLowerCase().trim();
  const password = formData.get("password") as string | null;

  if (!email || !password) {
    return { error: "メールアドレスとパスワードを入力してください" };
  }
  if (password.length < 8) {
    return { error: "パスワードは8文字以上にしてください" };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "このメールアドレスは既に登録されています" };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, passwordHash, role: "user" },
  });

  // 組織を作成し、初期設定をシード
  await provisionOrganizationForUser(user.id, name ?? email);

  // 作成後そのままログインしてダッシュボードへ
  await signIn("credentials", { email, password, redirectTo: "/" });

  return {};
}
