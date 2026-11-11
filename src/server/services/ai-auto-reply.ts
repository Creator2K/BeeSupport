import type { AiJob } from "@prisma/client";

import { AiError, type AiConfig } from "../../lib/ai";
import type { EffectiveAiPolicy } from "../../lib/ai-policy";
import { countOnlineAgents } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { lockConversation } from "../transactions";
import { broadcastAiUpdate } from "./ai-broadcast";
import { insertAiMessage } from "./ai-message";
import { readAiContext } from "./ai-context";
import {
  aiJobLease,
  lockAiJobLease,
  type AiJobLease,
  type AiJobOutcome,
} from "./ai-job-queue";
import { resolveAiPolicyForSite } from "./ai-policy";
import {
  buildConversationMessages,
  runConversation,
  type AiRunResult,
} from "./ai-runner";
import {
  checkAiQuota,
  recordAiUsage,
  type AiQuotaBlock,
} from "./ai-usage";

const HUMAN_ACTIVE_WINDOW_MS = 5 * 60 * 1000;

export type AutoReplyDecision =
  | {
      reply: true;
      config: AiConfig;
      tenantId: string;
      siteId: string;
      policy: EffectiveAiPolicy;
    }
  | { reply: false; reason: string; quota?: AiQuotaBlock };

/**
 * 是否应该让 AI 自动回复这条会话。
 * 只做判定，不产生副作用，方便单独测试。
 */
export async function decideAutoReply(
  conversationId: string,
): Promise<AutoReplyDecision> {
  const conversation = await readAiContext(prisma, { conversationId });
  if (!conversation) return { reply: false, reason: "conversation_unavailable" };

  const resolved = await resolveAiPolicyForSite(conversation.siteId);
  if (!resolved) return { reply: false, reason: "site_unavailable" };
  const config = resolved.policy.config;
  if (!resolved.policy.enabled) return { reply: false, reason: "ai_policy_disabled" };
  if (config.autoReply === "off")
    return { reply: false, reason: "auto_reply_off" };

  const quota = await checkAiQuota(resolved.tenantId, conversation.siteId, resolved.policy);
  if (!quota.ok)
    return {
      reply: false,
      reason: quota.reason === "request_limit" ? "monthly_request_limit" : "monthly_token_limit",
      quota,
    };

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
    return { reply: true, config, tenantId: resolved.tenantId, siteId: conversation.siteId, policy: resolved.policy };
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

  return { reply: true, config, tenantId: resolved.tenantId, siteId: conversation.siteId, policy: resolved.policy };
}

/**
 * 生成访客侧的自动回复文本。返回 null 表示当前不该回复。
 */
export async function generateAutoReply(
  conversationId: string,
  leaseToken?: string,
  task?: AiJobLease & { expectedMessageId: string },
): Promise<
  (AiRunResult & { assistantName: string; targetMessageId: string }) | null
> {
  const decision = await decideAutoReply(conversationId);
  if (!decision.reply) {
    if (decision.quota) await handOffQuotaBlocked(conversationId, task, decision.quota);
    if (process.env.NODE_ENV !== "production") {
      console.log(`[ai] 跳过自动回复：${decision.reason}`);
    }
    return null;
  }

  const conversation = await readAiContext(prisma, { conversationId, leaseToken, ...task });
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
    policy: decision.policy,
    allowMutations: Boolean(leaseToken && decision.policy.allowMutations),
    expectedMessageId: lastMeaningful.id,
    leaseToken,
    ...task,
  });

  try {
    const result = await runConversation({
      config: decision.config,
      messages,
      context,
    });
    if (!result.text.trim()) throw new AiError("模型没有返回内容");
    await recordAiUsage({
      tenantId: decision.tenantId,
      siteId: decision.siteId,
      requests: result.requests,
      promptTokens: result.usage?.promptTokens ?? 0,
      completionTokens: result.usage?.completionTokens ?? 0,
    });
    return {
      ...result,
      assistantName: decision.config.assistantName,
      targetMessageId: lastMeaningful.id,
    };
  } catch (error) {
    await recordAiUsage({
      tenantId: decision.tenantId,
      siteId: decision.siteId,
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      failed: true,
    }).catch(() => undefined);
    throw error;
  }
}

async function handOffQuotaBlocked(
  conversationId: string,
  task: (AiJobLease & { expectedMessageId: string }) | undefined,
  quota: AiQuotaBlock,
) {
  if (quota.action !== "handoff" || !task?.expectedMessageId) return;
  const note = await prisma.$transaction(async (tx) => {
    await lockConversation(tx, conversationId);
    if (!(await lockAiJobLease(tx, task))) return null;
    const conversation = await readAiContext(tx, { conversationId, ...task });
    if (!conversation) return null;
    const clientId = `ai-quota:${task.expectedMessageId}`;
    const existing = await tx.message.findUnique({
      where: { conversationId_clientId: { conversationId, clientId } },
      select: { id: true },
    });
    if (existing) return null;
    const created = await tx.message.create({
      data: {
        conversationId,
        sender: "SYSTEM",
        type: "NOTE",
        body:
          quota.reason === "request_limit"
            ? "AI 本月调用次数已达上限，本次未自动回复，请人工跟进。"
            : "AI 本月用量已达上限，本次未自动回复，请人工跟进。",
        clientId,
        readByAgentAt: new Date(),
      },
      select: { id: true },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { priority: 3 },
    });
    return created.id;
  });
  if (note) await broadcastAiUpdate(conversationId, note);
}

/** The durable worker owns retries; exceptions must reach it instead of being swallowed. */
export async function processAutoReply(job: AiJob): Promise<AiJobOutcome> {
  if (!job.conversationId || !job.messageId) throw new Error("Invalid automatic reply task");
  const identity = { ...aiJobLease(job), expectedMessageId: job.messageId };
  const generated = await generateAutoReply(job.conversationId, identity.leaseToken, identity);
  if (!generated) return { status: "SKIPPED", result: { reason: "not_eligible_or_superseded" } };

  const conversation = await readAiContext(prisma, { conversationId: job.conversationId, ...identity });
  if (!conversation)
    return { status: "SKIPPED", result: { reason: "access_or_message_changed" } };
  const resolved = await resolveAiPolicyForSite(conversation.siteId);
  if (
    !resolved ||
    !resolved.policy.enabled ||
    resolved.policy.config.autoReply === "off"
  )
    return { status: "SKIPPED", result: { reason: "policy_changed" } };

  const inserted = await insertAiMessage({
    conversationId: job.conversationId,
    siteId: conversation.siteId,
    body: generated.text,
    authorName: generated.assistantName,
    ...identity,
    meta: {
      ai: {
        model: generated.model,
        tools: generated.trace,
        knowledge: generated.knowledge,
        rounds: generated.rounds,
        requests: generated.requests,
        usage: generated.usage,
      },
    },
  });
  return inserted
    ? { status: "COMPLETED", result: { messageId: inserted } }
    : { status: "SKIPPED", result: { reason: "superseded_before_commit" } };
}
