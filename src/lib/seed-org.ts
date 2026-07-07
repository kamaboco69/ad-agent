import { prisma } from "@/lib/db";

// 新規ユーザーに組織を作成してユーザーに紐づける。
// Credentials サインアップと Google OAuth（events.createUser）の両方で使う。
export async function provisionOrganizationForUser(
  userId: string,
  displayName?: string | null
): Promise<string> {
  const orgName = displayName ? `${displayName}のワークスペース` : "マイワークスペース";
  const org = await prisma.organization.create({
    data: { name: orgName, ownerId: userId, plan: "free" },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { organizationId: org.id },
  });

  return org.id;
}
