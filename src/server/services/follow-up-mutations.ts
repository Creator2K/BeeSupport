import { HttpError, type SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { rateLimit } from "../../lib/rate-limit";
import {
  followUpActionSchema,
  validateFollowUpDue,
  type FollowUpAction,
} from "../../lib/follow-ups";
import {
  conversationFor,
  eligibleOwners,
  manager,
  scope,
  taskDto,
  taskSelect,
} from "./follow-up-access";

export async function changeFollowUp(
  actor: SessionUser,
  conversationId: string,
  input: FollowUpAction,
  now = new Date(),
) {
  scope(actor);
  const data = followUpActionSchema.parse(input);
  let dueAt: Date | undefined;
  if (data.action === "save") {
    try {
      dueAt = validateFollowUpDue(data.dueAt, now);
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : "跟进时间无效",
      );
    }
    if (!manager(actor) && data.ownerId !== actor.id)
      throw new HttpError(403, "客服只能为自己安排跟进");
  }
  if (!(await rateLimit(`followup:${actor.id}`, 60, 60)).ok)
    throw new HttpError(429, "操作过于频繁，请稍后重试");
  return prisma.$transaction(async (tx) => {
    // A conversation lock serializes creation, edits and conversation deletion without adding public messages.
    const conversation = await conversationFor(actor, conversationId, tx);
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
    const current = await tx.followUp.findUnique({
      where: { conversationId },
      select: { ...taskSelect, tenantId: true },
    });
    if (current && current.tenantId !== conversation.site.tenantId)
      throw new HttpError(403, "任务归属无效");
    if (current && !manager(actor) && current.ownerId !== actor.id)
      throw new HttpError(403, "只能处理自己负责的跟进任务");
    if ((current?.version ?? 0) !== data.expectedVersion)
      throw new HttpError(409, "跟进任务已被更新，请刷新后再操作");
    let task;
    if (data.action === "save") {
      const owner = await tx.user.findFirst({
        where: {
          AND: [
            eligibleOwners(conversation.site.tenantId, conversation.siteId),
            { id: data.ownerId },
          ],
        },
        select: { id: true },
      });
      if (!owner)
        throw new HttpError(400, "负责人须为本商家启用且有该站点权限的成员");
      const values = {
        ownerId: owner.id,
        note: data.note,
        dueAt: dueAt!,
        status: "OPEN",
        finishedAt: null,
      };
      task = current
        ? await tx.followUp.update({
            where: { id: current.id, version: data.expectedVersion },
            data: { ...values, version: { increment: 1 } },
            select: taskSelect,
          })
        : await tx.followUp.create({
            data: {
              ...values,
              conversationId,
              tenantId: conversation.site.tenantId,
            },
            select: taskSelect,
          });
    } else {
      if (!current || current.status !== "OPEN")
        throw new HttpError(409, "任务已处理或不存在，请刷新后查看");
      task = await tx.followUp.update({
        where: { id: current.id, version: data.expectedVersion },
        data: {
          status: data.action === "complete" ? "DONE" : "CANCELLED",
          finishedAt: now,
          version: { increment: 1 },
        },
        select: taskSelect,
      });
    }
    await tx.auditLog.create({
      data: {
        tenantId: conversation.site.tenantId,
        actorId: actor.id,
        actorName: actor.name,
        action: `followup.${data.action === "save" ? (current ? "update" : "create") : data.action}`,
        targetType: "FollowUp",
        targetId: task.id,
        meta: {
          conversationId,
          ownerId: task.ownerId,
          dueAt: task.dueAt.toISOString(),
          version: task.version,
          status: task.status,
        },
      },
    });
    return taskDto(task);
  });
}
