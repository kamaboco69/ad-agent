// ローカル動作確認用のテストユーザーを作成する（npx tsx scripts/create-test-user.ts）
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

const email = process.env.TEST_USER_EMAIL ?? "demo@adagent.local";
const password = process.env.TEST_USER_PASSWORD ?? "demo-pass-1234";

async function main() {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log("user already exists:", email);
  } else {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, name: "デモユーザー", passwordHash },
    });
    const org = await prisma.organization.create({
      data: { name: "デモワークスペース", ownerId: user.id },
    });
    await prisma.user.update({ where: { id: user.id }, data: { organizationId: org.id } });
    console.log("user created:", email);
  }
  await prisma.$disconnect();
}

main();
