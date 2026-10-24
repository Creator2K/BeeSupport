import type { SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import {
  conversationFor,
  eligibleOwners,
  manager,
  scope,
  taskDto,
  taskSelect,
} from "./follow-up-access";

export async function getFollowUpDetails(
  actor: SessionUser,
  conversationId: string,
) {
  scope(actor);
  return prisma.$transaction(async (tx) => {
    const conversation = await conversationFor(actor, conversationId, tx);
    const [task, owners] = await Promise.all([
      tx.followUp.findFirst({
        where: { conversationId, tenantId: conversation.site.tenantId },
        select: taskSelect,
      }),
      tx.user.findMany({
        where: {
          AND: [
            eligibleOwners(conversation.site.tenantId, conversation.siteId),
            manager(actor) ? {} : { id: actor.id },
          ],
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);
    return {
      task: task ? taskDto(task) : null,
      owners,
      canEdit: manager(actor) || !task || task.ownerId === actor.id,
      defaultOwnerId: owners.some((user) => user.id === actor.id)
        ? actor.id
        : (owners[0]?.id ?? ""),
    };
  });
}
