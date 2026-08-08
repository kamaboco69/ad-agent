import { prisma } from "@/lib/db";
import { buildExportData, buildXlsx, buildPptx } from "@/lib/export";

// レポートの自動配信。Resend の API を直接叩く（SDKを足さずに済ませる）。
// RESEND_API_KEY / REPORT_MAIL_FROM が未設定なら送信せずその旨を返す。

export function mailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.REPORT_MAIL_FROM);
}

const yen = (v: number) => `¥${Math.round(v).toLocaleString()}`;

export async function sendReportMail(organizationId: string, connectionId: string): Promise<{ to: string[] }> {
  if (!mailConfigured()) {
    throw new Error("メール送信の設定（RESEND_API_KEY / REPORT_MAIL_FROM）が未完了です");
  }
  const tpl = await prisma.reportTemplate.findUnique({ where: { connectionId } });
  const to = (tpl?.recipients ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));
  if (to.length === 0) throw new Error("宛先が未設定です");

  const data = await buildExportData(organizationId, connectionId, 30);
  const [xlsx, pptx] = await Promise.all([buildXlsx(data), buildPptx(data)]);
  const t = data.totals;
  const cpa = t.conversions > 0 ? t.costYen / t.conversions : null;

  const html = `
    <div style="font-family:sans-serif;line-height:1.8;color:#1c2733">
      <p>${data.clientName} 御中</p>
      <p>いつもお世話になっております。${data.agencyName ?? ""}です。<br>
      ${data.periodLabel} の広告運用レポートをお送りいたします。</p>
      <table style="border-collapse:collapse;font-size:14px;margin:16px 0">
        <tr><td style="padding:4px 16px 4px 0;color:#5b6b7c">広告費用</td><td><b>${yen(t.costYen)}</b></td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#5b6b7c">コンバージョン</td><td><b>${t.conversions.toFixed(1)}件</b></td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#5b6b7c">獲得単価(CPA)</td><td><b>${cpa ? yen(cpa) : "—"}</b></td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#5b6b7c">予算進捗</td><td><b>${data.pacing.statusLabel}</b>（着地予想 ${yen(data.pacing.forecastYen)}）</td></tr>
      </table>
      <p>詳細は添付の Excel / PowerPoint をご確認ください。<br>ご不明な点がございましたらお気軽にご連絡ください。</p>
    </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.REPORT_MAIL_FROM,
      to,
      subject: `【広告レポート】${data.clientName} 御中 ${data.periodLabel}`,
      html,
      attachments: [
        { filename: "report.xlsx", content: xlsx.toString("base64") },
        { filename: "report.pptx", content: pptx.toString("base64") },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`メール送信に失敗しました: ${res.status} ${body.slice(0, 200)}`);
  }
  await prisma.reportTemplate.update({ where: { connectionId }, data: { lastSentAt: new Date() } });
  return { to };
}

// 毎日のcronから呼ぶ。設定された日になったクライアントへ自動配信する。
export async function runReportDelivery(force = false): Promise<{ sent: number; skipped: number }> {
  if (!mailConfigured()) return { sent: 0, skipped: 0 };
  const jstDay = new Date(Date.now() + 9 * 3600_000).getUTCDate();

  const targets = await prisma.reportTemplate.findMany({
    where: { autoSend: true, recipients: { not: null }, ...(force ? {} : { sendDay: jstDay }) },
  });
  let sent = 0;
  let skipped = 0;
  for (const t of targets) {
    // 同じ月に既に送っていれば送らない（cronの重複実行対策）
    if (!force && t.lastSentAt && Date.now() - t.lastSentAt.getTime() < 20 * 86400_000) {
      skipped++;
      continue;
    }
    try {
      await sendReportMail(t.organizationId, t.connectionId);
      sent++;
    } catch {
      skipped++;
    }
  }
  return { sent, skipped };
}
