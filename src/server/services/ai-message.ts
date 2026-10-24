import { HttpError } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { broadcastConversation, broadcastMessage } from "./broadcast";
import { lockConversation } from "../transactions";
import type {
  AiKnowledgeTrace,
  AiToolTrace,
} from "./ai-tools";

const MAX_AI_BODY_LENGTH = 5000;

/** AI 消息附带的过程信息，存在 Message.meta 里，工作台可展开查看 */
export type AiMessageMeta = {
  ai: {
    model: string;
    tools: AiToolTrace[];
    knowledge: AiKnowledgeTrace[];
    rounds: number;
    usage: { promptTokens: number; completionTokens: number } | null;
  };
};

/**
 * AI 回复落库。
 * 会话状态刻意保持不变：AI 回复不等于人工接入，会话仍在排队/进行中，
 * 只是访客侧立刻拿到了回答。
 *
 * 放在这里（而不是 messages.ts）是为了避免 messages ↔ ai 的循环依赖。
 */
export async function insertAiMessage(input: {
  conversationId: string;
  siteId: string;
  body: string;
  authorName: string | null;
  meta?: AiMessageMeta;
  expectedMessageId?: string;
  leaseToken?: string;
}): Promise<string | null> {
  const body = input.body.trim().slice(0, MAX_AI_BODY_LENGTH);
  if (!body) throw new HttpError(400, "AI 回复内容为空");

  const message = await prisma.$transaction(async (tx) => {
    await lockConversation(tx, input.conversationId);
    const conversation = await tx.conversation.findUnique({
      where: { id: input.conversationId },
      select: { status: true, aiReplyToken: true },
    });
    if (
      !conversation ||
      conversation.status === "CLOSED" ||
      (input.leaseToken && conversation.aiReplyToken !== input.leaseToken)
    )
      return null;
    if (input.expectedMessageId) {
      const latest = await tx.message.findFirst({
        where: {
          conversationId: input.conversationId,
          sender: { not: "SYSTEM" },
          type: { notIn: ["SYSTEM", "NOTE"] },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, sender: true },
      });
      if (latest?.id !== input.expectedMessageId || latest.sender !== "VISITOR")
        return null;
    }
    const message = await tx.message.create({
      data: {
        conversationId: input.conversationId,
        sender: "AI",
        type: "TEXT",
        body,
        authorName: input.authorName,
        meta: input.meta ? (input.meta as object) : undefined,
        readByAgentAt: new Date(),
      },
    });

    const now = new Date();
    await tx.conversation.update({
      where: { id: input.conversationId },
      data: {
        lastMessageAt: now,
        lastMessagePreview: body.slice(0, 120),
        unreadForVisitor: { increment: 1 },
      },
    });
    return message;
  });
  if (!message) return null;

  await broadcastMessage(message.id);
  await broadcastConversation(input.conversationId);
  return message.id;
}

/* ---------------- 自动回复 ---------------- */
