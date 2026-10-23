import { z } from "zod";
import { prisma } from "../../lib/db";
import { env } from "../../lib/env";
import { sendMail, type SendMailInput } from "../../lib/mail";
import {
  ACCOUNT_TOKEN_PATTERN,
  accountTokenHash,
  openAccountToken,
} from "../../lib/account-links";

const payloadSchema = z.object({
  tokenId: z.string().min(1),
  encrypted: z.string().max(300),
});

export type PreparedAccountMail =
  | { ok: true; mail: SendMailInput }
  | { ok: false; skipped?: boolean; retryable?: boolean; error?: string };

export async function prepareAccountMail(
  payload: unknown,
  jobId: string,
): Promise<PreparedAccountMail> {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success)
    return {
      ok: false,
      retryable: false,
      error: "Invalid account mail payload",
    };
  let raw: string;
  try {
    raw = openAccountToken(parsed.data.encrypted, env.AUTH_SECRET);
    if (!ACCOUNT_TOKEN_PATTERN.test(raw)) throw new Error("Invalid credential");
  } catch {
    return {
      ok: false,
      retryable: false,
      error: "Account mail credential cannot be decrypted; request a new link",
    };
  }
  const row = await prisma.accountToken.findUnique({
    where: { id: parsed.data.tokenId },
    include: {
      user: true,
      tenant: { select: { name: true, status: true, expiresAt: true } },
    },
  });
  if (
    !row ||
    row.tokenHash !== accountTokenHash(raw) ||
    row.usedAt ||
    row.revokedAt ||
    row.expiresAt <= new Date()
  )
    return { ok: false, skipped: true };
  if (row.purpose === "INVITE") {
    const issuer = row.inviterId
      ? await prisma.user.findFirst({
          where: {
            id: row.inviterId,
            tenantId: row.tenantId,
            active: true,
            role: { in: ["ADMIN", "MERCHANT_ADMIN"] },
          },
        })
      : null;
    if (
      !issuer ||
      row.tenant.status !== "ACTIVE" ||
      (row.tenant.expiresAt && row.tenant.expiresAt <= new Date())
    )
      return { ok: false, skipped: true };
  } else if (
    !row.user?.active ||
    row.user.email !== row.email ||
    row.user.tokenVersion !== row.tokenVersion ||
    (row.purpose === "VERIFY" && row.user.emailVerifiedAt)
  )
    return { ok: false, skipped: true };
  const path =
    row.purpose === "RESET"
      ? "/reset-password"
      : row.purpose === "VERIFY"
        ? "/verify-email"
        : row.purpose === "INVITE"
          ? "/accept-invite"
          : null;
  if (!path)
    return {
      ok: false,
      retryable: false,
      error: "Invalid account mail purpose",
    };
  const url = new URL(path, env.APP_URL);
  url.hash = `token=${raw}`;
  const label =
    row.purpose === "RESET"
      ? "重置密码"
      : row.purpose === "VERIFY"
        ? "验证邮箱"
        : "接受团队邀请";
  return {
    ok: true,
    mail: {
      to: row.email,
      subject: `BeeSupport · ${label}`,
      text: `${row.purpose === "INVITE" ? `你受邀加入「${row.tenant.name}」。` : "你正在申请账号操作。"}\n\n请打开以下链接并确认${label}：\n${url.toString()}\n\n链接将在 ${row.expiresAt.toISOString()} 到期，且只能使用一次。如果不是你本人申请，请忽略此邮件。`,
      messageId: `<${jobId}@beesupport>`,
    },
  };
}

export async function deliverAccountMail(payload: unknown, jobId: string) {
  const prepared = await prepareAccountMail(payload, jobId);
  if (!prepared.ok) return prepared;
  const result = await sendMail(prepared.mail);
  // Missing SMTP is retryable for credential mail; never silently mark it sent.
  return result.ok
    ? result
    : { ok: false, error: "账号邮件发送失败，请检查 SMTP 配置" };
}
