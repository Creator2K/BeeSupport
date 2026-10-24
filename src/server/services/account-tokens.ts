import type { AccountToken, Prisma } from "@prisma/client";

import { HttpError, hashPassword } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { revokeAgentConnections } from "../../lib/realtime/emit";
import { passwordSchema } from "../../lib/validation";
import {
  ACCOUNT_TOKEN_PATTERN,
  accountTokenHash,
} from "../../lib/account-links";

export const invalidLink = () =>
  new HttpError(400, "链接无效、已使用或已过期，请重新申请");

export function assertLive(
  row: AccountToken | null,
  purpose?: string,
): asserts row is AccountToken {
  if (
    !row ||
    (purpose && row.purpose !== purpose) ||
    row.usedAt ||
    row.revokedAt ||
    row.expiresAt <= new Date()
  )
    throw invalidLink();
}

export async function findToken(raw: string, db: Prisma.TransactionClient = prisma) {
  if (!ACCOUNT_TOKEN_PATTERN.test(raw)) throw invalidLink();
  const row = await db.accountToken.findUnique({
    where: { tokenHash: accountTokenHash(raw) },
  });
  assertLive(row);
  return row;
}

export async function inspectAccountToken(
  raw: string,
  purpose: "RESET" | "VERIFY" | "INVITE",
) {
  const row = await findToken(raw);
  assertLive(row, purpose);
  const tenant = await prisma.tenant.findUnique({
    where: { id: row.tenantId },
    select: { name: true },
  });
  return {
    email: row.email,
    team: tenant?.name ?? "BeeSupport",
    role: row.role === "AGENT" ? "客服" : "团队管理员",
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function claimToken(tx: Prisma.TransactionClient, row: AccountToken) {
  const claimed = await tx.accountToken.updateMany({
    where: {
      id: row.id,
      tokenHash: row.tokenHash,
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) throw invalidLink();
}

export async function consumeAccountToken(
  raw: string,
  purpose: "RESET" | "VERIFY",
  password?: string,
) {
  // Validate the token before expensive hashing; the transaction rechecks it under a lock.
  const row = await findToken(raw);
  assertLive(row, purpose);
  const passwordHash =
    purpose === "RESET"
      ? await hashPassword(passwordSchema.parse(password))
      : undefined;
  const userId = await prisma.$transaction(async (tx) => {
    const locked = await tx.user.updateMany({
      where: {
        id: row.userId!,
        email: row.email,
        active: true,
        tokenVersion: row.tokenVersion!,
      },
      data: { updatedAt: new Date() },
    });
    if (locked.count !== 1) throw invalidLink();
    await claimToken(tx, row);
    const user = await tx.user.update({
      where: { id: row.userId! },
      data: {
        emailVerifiedAt: new Date(),
        ...(passwordHash
          ? { passwordHash, tokenVersion: { increment: 1 } }
          : {}),
      },
    });
    await tx.auditLog.create({
      data: {
        tenantId: user.tenantId,
        actorId: user.id,
        actorName: user.name,
        action:
          purpose === "RESET"
            ? "auth.password.recovered"
            : "auth.email.verified",
        targetType: "User",
        targetId: user.id,
      },
    });
    return user.id;
  });
  if (purpose === "RESET") revokeAgentConnections(userId);
}
