import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/db";
import { lockConversation } from "../transactions";
import { readAiContext } from "./ai-context";
import { broadcastAiUpdate } from "./ai-broadcast";
import type { ToolContext } from "./ai-tool-types";
import { lockAiJobLease, type AiJobLease } from "./ai-job-queue";

async function applyEffect(
  context: ToolContext,
  key: string,
  args: Prisma.InputJsonObject,
  apply: (tx: Prisma.TransactionClient, tags: string[]) => Promise<{ output: string; messageId?: string }>,
) {
  const result = await prisma.$transaction(async (tx) => {
    await lockConversation(tx, context.conversationId);
    if (context.jobId && !(await lockAiJobLease(tx, context as AiJobLease)))
      throw new Error("会话状态已改变，任务租约已失效");
    const conversation = await readAiContext(tx, context);
    if (!context.leaseToken || !context.expectedMessageId || !conversation)
      throw new Error("会话状态已改变，已取消修改");
    const where = { messageId_key: { messageId: context.expectedMessageId, key } };
    const existing = await tx.aiToolEffect.findUnique({ where });
    if (existing) return { output: existing.output, args: existing.arguments, applied: false };
    const effect = await apply(tx, conversation.tags);
    await tx.aiToolEffect.create({
      data: { messageId: context.expectedMessageId, key, arguments: args, output: effect.output },
    });
    return { ...effect, args, applied: true };
  });
  if (result.applied)
    await broadcastAiUpdate(context.conversationId, "messageId" in result ? result.messageId : undefined);
  return result;
}

export async function escalateToHuman(
  context: ToolContext,
  args: Record<string, unknown>,
  name: string,
  startedAt: number,
): Promise<string> {
  if (!context.allowMutations) {
    context.trace.push({
      name: name,
      arguments: args,
      summary: "草稿模式下忽略转人工",
      ok: false,
      ms: Date.now() - startedAt,
    });
    return "当前是草稿模式，未真正转人工。";
  }

  const reason = String(args.reason ?? "需要人工协助").slice(0, 200);
  const priority = Math.min(
    3,
    Math.max(1, Math.round(Number(args.priority ?? 2) || 2)),
  );

  // One escalation per visitor message, even if a retry receives different model arguments.
  const result = await applyEffect(context, "escalate_to_human", { reason, priority }, async (tx) => {
    await tx.conversation.update({
      where: { id: context.conversationId },
      data: { priority },
    });
    const note = await tx.message.create({
      data: {
        conversationId: context.conversationId,
        sender: "SYSTEM",
        type: "NOTE",
        body: `AI 建议转人工：${reason}（优先级 P${priority}）`,
        readByAgentAt: new Date(),
      },
    });
    return { output: `已把会话标记为需要人工跟进，并写入内部备注：${reason}（P${priority}）。`, messageId: note.id };
  });

  context.trace.push({
    name: name,
    arguments: result.args as Record<string, unknown>,
    summary: result.output,
    ok: true,
    ms: Date.now() - startedAt,
  });
  return result.output;
}

export async function tagConversation(
  context: ToolContext,
  args: Record<string, unknown>,
  name: string,
  startedAt: number,
): Promise<string> {
  const tags = Array.isArray(args.tags)
    ? args.tags
        .map((tag) => String(tag).trim().slice(0, 24))
        .filter(Boolean)
        .slice(0, 3)
    : [];

  if (tags.length === 0) return "没有解析到有效标签。";

  if (!context.allowMutations) {
    context.trace.push({
      name: name,
      arguments: { tags },
      summary: "草稿模式下忽略打标签",
      ok: false,
      ms: Date.now() - startedAt,
    });
    return "当前是草稿模式，未写入标签。";
  }

  const key = `tag_conversation:${createHash("sha256").update(JSON.stringify([...new Set(tags)].sort())).digest("hex")}`;
  const result = await applyEffect(context, key, { tags }, async (tx, existingTags) => {
    const merged = Array.from(new Set([...existingTags, ...tags])).slice(0, 12);
    await tx.conversation.update({
      where: { id: context.conversationId },
      data: { tags: merged },
    });
    return { output: `已为会话添加标签：${tags.join("、")}` };
  });

  context.trace.push({
    name: name,
    arguments: { tags },
    summary: `新增标签：${tags.join("、")}`,
    ok: true,
    ms: Date.now() - startedAt,
  });
  return result.output;
}
