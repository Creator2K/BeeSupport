import type { AccountToken, Prisma } from "@prisma/client";

import { prisma } from "../../lib/db";
import { env } from "../../lib/env";
import { getSmtpConfig } from "../../lib/mail";
import { rateLimit } from "../../lib/rate-limit";
import { emailSchema } from "../../lib/validation";
import {
  ACCOUNT_POLICY_KEY,
  accountTokenHash,
  newAccountToken,
  sealAccountToken,
} from "../../lib/account-links";

export const requestMailMessage =
  "如果该邮箱符合条件，我们会发送邮件。请检查收件箱和垃圾邮件；无法收信时请联系管理员。";

export async function getAccountPolicy() {
  const setting = await prisma.setting.findUnique({
    where: { key: ACCOUNT_POLICY_KEY },
  });
  const value = setting?.value as
    { requireEmailVerification?: unknown } | undefined;
  return { requireEmailVerification: value?.requireEmailVerification === true };
}

export async function queueAccountMail(
  db: Prisma.TransactionClient,
  row: AccountToken,
  rawToken: string,
) {
  await db.notificationJob.create({
    data: {
      kind: "ACCOUNT_MAIL",
      payload: {
        tokenId: row.id,
        encrypted: sealAccountToken(rawToken, env.AUTH_SECRET),
      },
    },
  });
}

export async function issueVerification(
  db: Prisma.TransactionClient,
  user: { id: string; tenantId: string; email: string; tokenVersion: number },
) {
  const raw = newAccountToken();
  const row = await db.accountToken.create({
    data: {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      tokenVersion: user.tokenVersion,
      purpose: "VERIFY",
      tokenHash: accountTokenHash(raw),
      expiresAt: new Date(Date.now() + 24 * 3600_000),
    },
  });
  await queueAccountMail(db, row, raw);
}

/** Deliberately identical for absent, inactive, verified and mail-disabled accounts. */
export async function requestAccountMail(
  purpose: "RESET" | "VERIFY",
  inputEmail: string,
  ip: string,
) {
  const email = emailSchema.parse(inputEmail);
  const [ipBudget, accountBudget] = await Promise.all([
    rateLimit(`account-mail:ip:${ip}`, 10, 3600),
    rateLimit(`account-mail:email:${email}`, 3, 3600),
  ]);
  if (!ipBudget.ok || !accountBudget.ok || !(await getSmtpConfig())) return;
  const raw = newAccountToken();
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { email } });
    if (
      !user?.active ||
      (purpose === "VERIFY" &&
        (!user.emailVerificationRequired || user.emailVerifiedAt))
    )
      return;
    const row = await tx.accountToken.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        email,
        tokenVersion: user.tokenVersion,
        purpose,
        tokenHash: accountTokenHash(raw),
        expiresAt: new Date(
          Date.now() + (purpose === "RESET" ? 30 * 60_000 : 24 * 3600_000),
        ),
      },
    });
    // Issuing another link does not invalidate one already in the user's inbox.
    await queueAccountMail(tx, row, raw);
  });
}
