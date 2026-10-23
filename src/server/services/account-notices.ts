import type { Prisma } from "@prisma/client";
import type { SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
export async function visibleNoticeWhere(
  user: Pick<SessionUser, "id" | "tenantId">,
): Promise<Prisma.AccountNoticeWhereInput> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: user.tenantId },
    select: { expiresAt: true },
  });
  return {
    userId: user.id,
    tenantId: user.tenantId,
    OR: [
      { kind: { not: "subscription.expiry" } },
      ...(tenant?.expiresAt
        ? [{ kind: "subscription.expiry", expirySnapshot: tenant.expiresAt }]
        : []),
    ],
  };
}
export async function unreadNoticeCount(
  user: Pick<SessionUser, "id" | "tenantId">,
) {
  return prisma.accountNotice.count({
    where: { ...(await visibleNoticeWhere(user)), readAt: null },
  });
}
