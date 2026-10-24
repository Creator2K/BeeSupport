import { prisma } from "../../lib/db";
import {
  broadcastConversation,
  broadcastMessage,
} from "./broadcast";
import type { ToolContext } from "./ai-tool-types";

async function createInternalNote(
  conversationId: string,
  body: string,
): Promise<void> {
  const message = await prisma.message.create({
    data: {
      conversationId,
      sender: "SYSTEM",
      type: "NOTE",
      body: body.slice(0, 2000),
      readByAgentAt: new Date(),
    },
  });
  await broadcastMessage(message.id);
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
    Math.max(1, Number(args.priority ?? 2) || 2),
  );

  await prisma.conversation.update({
    where: { id: context.conversationId },
    data: { priority },
  });
  await createInternalNote(
    context.conversationId,
    `AI 建议转人工：${reason}（优先级 P${priority}）`,
  );
  await broadcastConversation(context.conversationId);

  context.trace.push({
    name: name,
    arguments: { reason, priority },
    summary: `已标记转人工：${reason}`,
    ok: true,
    ms: Date.now() - startedAt,
  });
  return "已把会话标记为需要人工跟进，并写入内部备注。";
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

  const conversation = await prisma.conversation.findUnique({
    where: { id: context.conversationId },
    select: { tags: true },
  });
  const merged = Array.from(
    new Set([...(conversation?.tags ?? []), ...tags]),
  ).slice(0, 12);

  await prisma.conversation.update({
    where: { id: context.conversationId },
    data: { tags: merged },
  });
  await broadcastConversation(context.conversationId);

  context.trace.push({
    name: name,
    arguments: { tags },
    summary: `新增标签：${tags.join("、")}`,
    ok: true,
    ms: Date.now() - startedAt,
  });
  return `已为会话添加标签：${tags.join("、")}`;
}
