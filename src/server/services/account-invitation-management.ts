import { HttpError, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { assertInviteAdmin } from "./account-invitation-schema";

export async function listInvitations(actor: SessionUser) {
  assertInviteAdmin(actor);
  const rows = await prisma.accountToken.findMany({
    where: {
      tenantId: actor.tenantId,
      purpose: "INVITE",
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      email: true,
      role: true,
      siteIds: true,
      expiresAt: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    expiresAt: row.expiresAt.toISOString(),
  }));
}

export async function revokeInvitation(actor: SessionUser, id: string) {
  assertInviteAdmin(actor);
  await prisma.$transaction(async (tx) => {
    // Match the same tenant lock/order as acceptance and quota-consuming writers.
    await tx.tenant.update({
      where: { id: actor.tenantId },
      data: { updatedAt: new Date() },
    });
    const changed = await tx.accountToken.updateMany({
      where: {
        id,
        tenantId: actor.tenantId,
        purpose: "INVITE",
        usedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    if (!changed.count) throw new HttpError(404, "邀请不存在或已失效");
    await tx.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorId: actor.id,
        actorName: actor.name,
        action: "team.invite.revoked",
        targetType: "AccountToken",
        targetId: id,
      },
    });
  });
}
