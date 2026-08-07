import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { DEFAULT_RULES, judgeValidity, type LeadRules } from "@/lib/leads";

// GET: 有効リードの自動判定ルール（未設定なら既定値）
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const rules = await prisma.leadRuleSet.findUnique({ where: { organizationId: ctx.organizationId } });
  return Response.json({ rules: rules ?? DEFAULT_RULES });
}

// PATCH: ルールを更新し、手動修正されていないリードを再判定する
export async function PATCH(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();

  const body = (await req.json().catch(() => ({}))) as Partial<LeadRules>;
  const data = {
    freeEmailInvalid: typeof body.freeEmailInvalid === "boolean" ? body.freeEmailInvalid : DEFAULT_RULES.freeEmailInvalid,
    requireCompany: typeof body.requireCompany === "boolean" ? body.requireCompany : DEFAULT_RULES.requireCompany,
    blockedDomains: typeof body.blockedDomains === "string" ? body.blockedDomains.slice(0, 4000) : null,
    blockedKeywords: typeof body.blockedKeywords === "string" ? body.blockedKeywords.slice(0, 4000) : null,
  };

  const rules = await prisma.leadRuleSet.upsert({
    where: { organizationId: ctx.organizationId },
    update: data,
    create: { organizationId: ctx.organizationId, ...data },
  });

  // 人が手動修正したものは触らずに再判定する
  const targets = await prisma.lead.findMany({
    where: { organizationId: ctx.organizationId, overridden: false },
    select: { id: true, email: true, companyName: true, memo: true },
  });
  let rejudged = 0;
  for (const t of targets) {
    const v = judgeValidity(t, rules);
    await prisma.lead.update({
      where: { id: t.id },
      data: { validity: v.validity, invalidReason: v.reason ?? null },
    });
    rejudged++;
  }

  return Response.json({ rules, rejudged });
}
