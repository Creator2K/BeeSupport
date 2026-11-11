import type { AiToolCall } from "../../lib/ai";
import { prisma } from "../../lib/db";
import { readAiContext } from "./ai-context";
import type { ToolContext } from "./ai-tool-types";
import {
  escalateToHuman,
  tagConversation,
} from "./ai-tool-actions";
import {
  getVisitorContext,
  searchKnowledge,
} from "./ai-tool-readers";

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function runTool(
  context: ToolContext,
  call: AiToolCall,
): Promise<string> {
  const startedAt = Date.now();
  const args = parseArguments(call.arguments);

  try {
    if (
      !context.config.enableTools ||
      context.policy?.enabled === false ||
      (context.allowMutations &&
        (context.policy?.allowMutations === false ||
          context.config.autoReply === "off")) ||
      !(await readAiContext(prisma, context, !context.allowMutations))
    )
      throw new Error("当前会话不可执行 AI 工具");
    switch (call.name) {
      case "search_knowledge":
        return await searchKnowledge(context, args, call.name, startedAt);
      case "get_visitor_context":
        return await getVisitorContext(context, args, call.name, startedAt);
      case "escalate_to_human":
        return await escalateToHuman(context, args, call.name, startedAt);
      case "tag_conversation":
        return await tagConversation(context, args, call.name, startedAt);
      default: {
        context.trace.push({
          name: call.name,
          arguments: args,
          summary: "未知工具",
          ok: false,
          ms: Date.now() - startedAt,
        });
        return `未知工具 ${call.name}`;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.trace.push({
      name: call.name,
      arguments: args,
      summary: `执行失败：${message}`,
      ok: false,
      ms: Date.now() - startedAt,
    });
    return `工具执行失败：${message}`;
  }
}
