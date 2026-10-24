import { Prisma } from "@prisma/client";
import { HttpError, type SessionUser } from "../../lib/auth";
import type { FollowUpTask } from "../../lib/follow-ups";

export function manager(actor: SessionUser) {
  return actor.role === "ADMIN" || actor.role === "MERCHANT_ADMIN";
}
export function scope(actor: SessionUser): Prisma.ConversationWhereInput {
  if (
    !actor.tenantId ||
    !["ADMIN", "MERCHANT_ADMIN", "AGENT"].includes(actor.role)
  )
    throw new HttpError(403, "无权访问跟进任务");
  return {
    ...(actor.role === "ADMIN" ? {} : { site: { tenantId: actor.tenantId } }),
    ...(actor.siteIds === null ? {} : { siteId: { in: actor.siteIds } }),
  };
}
export const taskSelect = {
  id: true,
  conversationId: true,
  ownerId: true,
  note: true,
  dueAt: true,
  status: true,
  version: true,
  finishedAt: true,
  owner: { select: { name: true, active: true } },
} satisfies Prisma.FollowUpSelect;
export type TaskRecord = Prisma.FollowUpGetPayload<{ select: typeof taskSelect }>;
export function taskDto(row: TaskRecord): FollowUpTask {
  return {
    id: row.id,
    conversationId: row.conversationId,
    ownerId: row.ownerId,
    ownerName: row.owner?.name ?? null,
    ownerActive: row.owner?.active ?? false,
    note: row.note,
    dueAt: row.dueAt.toISOString(),
    status: row.status as FollowUpTask["status"],
    version: row.version,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}
export function eligibleOwners(
  tenantId: string,
  siteId: string,
): Prisma.UserWhereInput {
  return {
    tenantId,
    active: true,
    OR: [
      { role: { in: ["MERCHANT_ADMIN", "ADMIN"] } },
      { role: "AGENT", sites: { some: { siteId } } },
    ],
  };
}
export async function conversationFor(
  actor: SessionUser,
  conversationId: string,
  tx: Prisma.TransactionClient,
) {
  const conversation = await tx.conversation.findFirst({
    where: { AND: [scope(actor), { id: conversationId }] },
    select: { id: true, siteId: true, site: { select: { tenantId: true } } },
  });
  if (!conversation) throw new HttpError(404, "会话不存在或无权访问");
  return conversation;
}

export function boardScope(
  actor: SessionUser,
  mine = false,
): Prisma.FollowUpWhereInput {
  return {
    conversation: scope(actor),
    ...(actor.role === "ADMIN" ? {} : { tenantId: actor.tenantId }),
    ...(!manager(actor) || mine ? { ownerId: actor.id } : {}),
  };
}
