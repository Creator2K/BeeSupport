import { randomUUID } from "node:crypto";

import {
  AiError,
  getAiConfig,
  isAiReady,
  type AiConfig,
} from "../../lib/ai";
import { countOnlineAgents } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { getSiteFeatures } from "./entitlements";
import { insertAiMessage } from "./ai-message";
import {
  buildConversationMessages,
  runConversation,
  type AiRunResult,
} from "./ai-runner";

const HUMAN_ACTIVE_WINDOW_MS = 5 * 60 * 1000;

export type AutoReplyDecision =
  { reply: true; config: AiConfig } | { reply: false; reason: string };

/**
 * 是否应该让 AI 自动回复这条会话。
 * 只做判定，不产生副作用，方便单独测试。
 */
export async function decideAutoReply(
  conversationId: string,
): Promise<AutoReplyDecision> {
  const config = await getAiConfig();
  if (!isAiReady(config)) return { reply: false, reason: "ai_not_configured" };
  if (config.autoReply === "off")
    return { reply: false, reason: "auto_reply_off" };

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      siteId: true,
      status: true,
      messages: {
        where: {
          sender: { not: "SYSTEM" },
          type: { notIn: ["SYSTEM", "NOTE"] },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { sender: true, type: true, body: true },
      },
    },
  });

  if (!conversation) return { reply: false, reason: "conversation_missing" };
  if (!(await getSiteFeatures(conversation.siteId)).ai)
    return { reply: false, reason: "plan_ai_disabled" };
  if (conversation.status === "CLOSED")
    return { reply: false, reason: "closed" };

  // 忽略系统消息（例如「已为你接入客服 X」），只看最后一条真实对话
  const lastMeaningful =
    conversation.messages.find(
      (message) =>
        message.sender !== "SYSTEM" &&
        message.type !== "SYSTEM" &&
        message.type !== "NOTE",
    ) ?? null;

  if (!lastMeaningful || lastMeaningful.sender !== "VISITOR") {
    return { reply: false, reason: "last_message_not_visitor" };
  }

  if (config.autoReply === "no_agent") {
    const online = await countOnlineAgents(conversation.siteId);
    if (online > 0) return { reply: false, reason: "agent_online" };
    return { reply: true, config };
  }

  // always：除非人工刚刚还在回复
  const recentAgentMessage = await prisma.message.findFirst({
    where: {
      conversationId,
      sender: "AGENT",
      type: { not: "NOTE" },
      createdAt: { gte: new Date(Date.now() - HUMAN_ACTIVE_WINDOW_MS) },
    },
    select: { id: true },
  });
  if (recentAgentMessage) return { reply: false, reason: "human_active" };

  return { reply: true, config };
}

/**
 * 生成访客侧的自动回复文本。返回 null 表示当前不该回复。
 */
export async function generateAutoReply(
  conversationId: string,
): Promise<
  (AiRunResult & { assistantName: string; targetMessageId: string }) | null
> {
  const decision = await decideAutoReply(conversationId);
  if (!decision.reply) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[ai] 跳过自动回复：${decision.reason}`);
    }
    return null;
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      siteId: true,
      site: { select: { name: true } },
      messages: {
        where: {
          sender: { not: "SYSTEM" },
          type: { notIn: ["SYSTEM", "NOTE"] },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { id: true, sender: true, type: true, body: true },
      },
    },
  });
  if (!conversation) return null;

  const lastMeaningful =
    conversation.messages.find(
      (message) =>
        message.sender !== "SYSTEM" &&
        message.type !== "SYSTEM" &&
        message.type !== "NOTE",
    ) ?? null;
  const query = lastMeaningful?.body ?? "";
  if (!lastMeaningful || lastMeaningful.sender !== "VISITOR") return null;

  const { messages, context } = await buildConversationMessages({
    conversationId,
    siteId: conversation.siteId,
    siteName: conversation.site.name,
    query,
    config: decision.config,
    allowMutations: true,
  });

  const result = await runConversation({
    config: decision.config,
    messages,
    context,
  });

  if (!result.text.trim()) throw new AiError("模型没有返回内容");
  return {
    ...result,
    assistantName: decision.config.assistantName,
    targetMessageId: lastMeaningful.id,
  };
}

/** 访客消息入库后调用：满足条件就让 AI 回复，失败只记日志，不影响主流程 */
export async function maybeAutoReply(conversationId: string): Promise<void> {
  const active = autoReplies.get(conversationId);
  if (active) {
    active.dirty = true;
    return active.promise;
  }
  const state = { dirty: true, promise: Promise.resolve() };
  autoReplies.set(conversationId, state);
  state.promise = (async () => {
    for (let attempt = 0; state.dirty && attempt < 3; attempt += 1) {
      state.dirty = false;
      if (await runAutoReply(conversationId)) state.dirty = true;
    }
  })().finally(() => autoReplies.delete(conversationId));
  return state.promise;
}

const autoReplies = new Map<
  string,
  { dirty: boolean; promise: Promise<void> }
>();

/** A database lease coalesces triggers across instances without holding a transaction during inference. */
async function runAutoReply(conversationId: string): Promise<boolean> {
  const token = randomUUID();
  const claimed = await prisma.conversation.updateMany({
    where: {
      id: conversationId,
      status: { not: "CLOSED" },
      OR: [
        { aiReplyExpiresAt: null },
        { aiReplyExpiresAt: { lte: new Date() } },
      ],
    },
    data: {
      aiReplyToken: token,
      aiReplyExpiresAt: new Date(Date.now() + 15 * 60_000),
    },
  });
  if (!claimed.count) return false;
  try {
    const generated = await generateAutoReply(conversationId);
    if (!generated) return false;

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { siteId: true, status: true },
    });
    if (!conversation || conversation.status === "CLOSED") return false;
    if (!(await getSiteFeatures(conversation.siteId)).ai) return false;
    const config = await getAiConfig();
    if (!isAiReady(config) || config.autoReply === "off") return false;

    const inserted = await insertAiMessage({
      conversationId,
      siteId: conversation.siteId,
      body: generated.text,
      authorName: generated.assistantName,
      expectedMessageId: generated.targetMessageId,
      leaseToken: token,
      meta: {
        ai: {
          model: generated.model,
          tools: generated.trace,
          knowledge: generated.knowledge,
          rounds: generated.rounds,
          usage: generated.usage,
        },
      },
    });
    return inserted === null;
  } catch (error) {
    const message = error instanceof AiError ? error.message : String(error);
    console.error("[ai] 自动回复失败:", message);
    return false;
  } finally {
    await prisma.conversation.updateMany({
      where: { id: conversationId, aiReplyToken: token },
      data: { aiReplyToken: null, aiReplyExpiresAt: null },
    });
  }
}
