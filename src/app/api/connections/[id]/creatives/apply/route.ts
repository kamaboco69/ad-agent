import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgContext, unauthorizedResponse } from "@/lib/auth-helpers";
import { getProvider } from "@/lib/providers";
import { toProviderConnection } from "@/lib/sync";
import { logChange } from "@/lib/rules";
import { adTextLength, AD_TEXT_LIMITS } from "@/lib/creatives";

// POST: AIの改善案を実際の広告に反映する（差し替え／追加）。
// 本番の配信に影響するため、変更ログに起票して14日後の効果検証にかける。
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorizedResponse();
  const { id } = await params;

  const conn = await prisma.adConnection.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!conn) return Response.json({ error: "not found" }, { status: 404 });
  if (conn.mode !== "api") return Response.json({ error: "デモ接続では広告を編集できません" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as {
    assetId?: string;
    mode?: string;
    newText?: string;
  };
  const mode = body.mode === "add" ? "add" : "replace";
  const newText = (body.newText ?? "").trim();
  if (!body.assetId || !newText) {
    return Response.json({ error: "対象と新しい文言を指定してください" }, { status: 400 });
  }

  const asset = await prisma.adAsset.findFirst({
    where: { id: body.assetId, organizationId: ctx.organizationId, connectionId: id },
  });
  if (!asset) return Response.json({ error: "対象のアセットが見つかりません" }, { status: 404 });
  if (asset.fieldType !== "HEADLINE" && asset.fieldType !== "DESCRIPTION") {
    return Response.json({ error: "見出しと説明文のみ編集できます" }, { status: 400 });
  }
  if (!asset.adExternalId) {
    return Response.json({ error: "広告に紐づかないアセットは編集できません" }, { status: 400 });
  }

  // 文字数はGoogleの仕様（全角は2文字分）で数える
  const limit = AD_TEXT_LIMITS[asset.fieldType];
  const len = adTextLength(newText);
  if (len > limit) {
    return Response.json(
      { error: `文字数が上限を超えています（${len}/${limit}。全角は2文字分として数えます）` },
      { status: 400 }
    );
  }

  const pconn = toProviderConnection(conn);
  const provider = getProvider(pconn.platform, "api");
  if (!provider.updateRsaAsset) {
    return Response.json({ error: "この媒体は広告文の編集に対応していません" }, { status: 400 });
  }

  try {
    const result = await provider.updateRsaAsset(pconn, asset.adExternalId, {
      fieldType: asset.fieldType,
      mode,
      oldText: asset.text,
      newText,
    });

    const label = asset.fieldType === "HEADLINE" ? "見出し" : "説明文";
    await prisma.adAsset.update({
      where: { id: asset.id },
      data: mode === "replace" ? { text: newText, aiVerdict: "applied", performanceLabel: null, lowSince: null } : { aiVerdict: "applied" },
    });
    await logChange({
      organizationId: ctx.organizationId,
      connectionId: id,
      kind: "creative",
      detail:
        mode === "replace"
          ? `${label}を差し替え「${asset.text}」→「${newText}」（${asset.adGroupName ?? asset.campaignName}）`
          : `${label}を追加「${newText}」（${asset.adGroupName ?? asset.campaignName}）`,
    });

    return Response.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: message }, { status: 502 });
  }
}
