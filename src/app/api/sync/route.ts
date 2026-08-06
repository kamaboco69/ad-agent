import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { syncOrganization } from "@/lib/sync";

// POST: 組織内の全接続を一括同期（手動の「全同期」ボタン用。直近30日分）
export async function POST() {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const outcomes = await syncOrganization(ctx.organizationId, 30);
  const ok = outcomes.filter((o) => o.ok).length;
  return Response.json({ total: outcomes.length, ok, failed: outcomes.length - ok });
}
