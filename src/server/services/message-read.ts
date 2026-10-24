import { HttpError, canAccessSite } from "../../lib/auth";
import type { SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { emitRead } from "../../lib/realtime/emit";
import { visitorMessage } from "../../lib/realtime/public";
import type { VisitorSession } from "../../lib/visitor-auth";
import { messageInclude, serializeMessage } from "../serialize";
import { lockConversation } from "../transactions";
import { broadcastConversation } from "./broadcast";

export async function markConversationRead(
  input: {
    conversationId: string;
  } & (
    | { by: "AGENT"; user: SessionUser }
    | { by: "VISITOR"; visitor: VisitorSession }
  ),
): Promise<void> {
  const conversation = await prisma.$transaction(async (tx) => {
    await lockConversation(tx, input.conversationId);
    const conversation = await tx.conversation.findUnique({
      where: { id: input.conversationId },
      select: { siteId: true, visitorId: true },
    });
    if (!conversation) throw new HttpError(404, "会话不存在");
    if (
      input.by === "AGENT"
        ? !canAccessSite(input.user, conversation.siteId)
        : input.visitor.visitorId !== conversation.visitorId ||
          input.visitor.siteId !== conversation.siteId
    ) {
      throw new HttpError(403, "无权访问该会话");
    }
    const now = new Date();

    if (input.by === "AGENT") {
      await tx.message.updateMany({
        where: {
          conversationId: input.conversationId,
          sender: "VISITOR",
          readByAgentAt: null,
        },
        data: { readByAgentAt: now },
      });
      await tx.conversation.update({
        where: { id: input.conversationId },
        data: { unreadForAgent: 0 },
      });
    } else {
      await tx.message.updateMany({
        where: {
          conversationId: input.conversationId,
          sender: { in: ["AGENT", "AI"] },
          type: { not: "NOTE" },
          readByVisitorAt: null,
        },
        data: { readByVisitorAt: now },
      });
      await tx.conversation.update({
        where: { id: input.conversationId },
        data: { unreadForVisitor: 0 },
      });
    }

    return conversation;
  });

  emitRead({
    conversationId: input.conversationId,
    by: input.by,
    visitorId: conversation.visitorId,
  });
  await broadcastConversation(input.conversationId);
}

export async function listConversationMessages(input: {
  conversationId: string;
  limit?: number;
  before?: string;
  /** 访客侧调用：过滤掉内部备注 */
  forVisitor?: boolean;
}): Promise<ReturnType<typeof serializeMessage>[]> {
  const messages = await prisma.message.findMany({
    where: {
      conversationId: input.conversationId,
      ...(input.forVisitor ? { type: { not: "NOTE" } } : {}),
    },
    include: messageInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(200, Math.max(1, input.limit ?? 200)),
    ...(input.before ? { cursor: { id: input.before }, skip: 1 } : {}),
  });

  return messages.reverse().map((message) => {
    const serialized = serializeMessage(message);
    return input.forVisitor ? visitorMessage(serialized) : serialized;
  });
}
