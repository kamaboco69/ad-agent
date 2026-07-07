import crypto from "crypto";

// X OAuth トークン等をアプリ層で暗号化/復号する（AES-256-GCM）。
// ENCRYPTION_KEY は 32byte の hex（64文字）を想定。未設定なら暗号化機能は無効。

const ALGO = "aes-256-gcm";

function getKey(): Buffer | null {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) return null;
  return Buffer.from(hex, "hex");
}

export function encryptionEnabled(): boolean {
  return getKey() !== null;
}

// 形式: iv(hex):authTag(hex):cipher(hex)
export function encryptSecret(plain: string): string {
  const key = getKey();
  if (!key) throw new Error("ENCRYPTION_KEY が未設定です");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(payload: string): string | null {
  const key = getKey();
  if (!key) return null;
  const parts = payload.split(":");
  if (parts.length !== 3) return null;
  try {
    const [ivHex, tagHex, dataHex] = parts;
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}
