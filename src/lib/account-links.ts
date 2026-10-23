import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";

export function newAccountToken() {
  return randomBytes(32).toString("hex");
}

export function accountTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function mailKey(secret: string) {
  return createHash("sha256")
    .update("beesupport-account-mail-v1\0")
    .update(secret)
    .digest();
}

/** The outbox can retry mail without persisting usable links in plaintext. */
export function sealAccountToken(token: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", mailKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    "base64url",
  );
}

export function openAccountToken(encrypted: string, secret: string) {
  const bytes = Buffer.from(encrypted, "base64url");
  if (bytes.length !== 92) throw new Error("Invalid account mail credential");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    mailKey(secret),
    bytes.subarray(0, 12),
  );
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([
    decipher.update(bytes.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}

export const ACCOUNT_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
export const ACCOUNT_POLICY_KEY = "platform.account-policy";
