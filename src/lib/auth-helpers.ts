import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";

export interface OrgContext {
  userId: string;
  organizationId: string;
  role: string;
}

// API route 用: 未認証/組織なしは null を返す（呼び出し側で 401 を返す）。
export async function getOrgContext(): Promise<OrgContext | null> {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return null;
  return {
    userId: session.user.id,
    organizationId: session.user.organizationId,
    role: session.user.role ?? "user",
  };
}

// API route 用: 未認証なら UnauthorizedError を throw する。
export async function requireOrg(): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (!ctx) throw new UnauthorizedError();
  return ctx;
}

// Server Component（ページ）用: 未認証なら /login にリダイレクト。
export async function requireOrgPage(): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  return ctx;
}

// admin ロール必須（管理画面API用）。
export async function requireAdmin(): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (!ctx || ctx.role !== "admin") throw new UnauthorizedError();
  return ctx;
}

// admin ロール必須（管理画面ページ用）。非adminは 404（存在を隠す）。
export async function requireAdminPage(): Promise<OrgContext> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "admin") notFound();
  return {
    userId: session.user.id,
    organizationId: session.user.organizationId ?? "",
    role: session.user.role,
  };
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

// API route の catch で使うヘルパー: UnauthorizedError を 401 に変換。
export function unauthorizedResponse() {
  return Response.json({ error: "認証が必要です" }, { status: 401 });
}
