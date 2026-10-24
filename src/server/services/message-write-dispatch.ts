import { prisma } from "../../lib/db";
import { maybeAutoReply } from "./ai";
import { broadcastConversation, broadcastMessage } from "./broadcast";
import { writeMessage } from "./message-write-core";
import type { CreateMessageInput } from "./message-write-types";

export async function insertMessage(
  input: CreateMessageInput,
): Promise<string> {
  const result = await prisma.$transaction((tx) => writeMessage(tx, input));
  await publishMessage(result);
  return result.id;
}

export async function publishMessage(
  result: Awaited<ReturnType<typeof writeMessage>>,
): Promise<void> {
  if (!result.created) return;
  const { id, input } = result;
  // A transport failure after commit must not turn a successful send into an API failure.
  await Promise.allSettled([
    broadcastMessage(id),
    broadcastConversation(input.conversationId),
  ]);

  // Notifications were committed with the message; AI runs after commit.
  if (input.sender === "VISITOR") {
    // AI 自动回复（判定条件见 services/ai）
    scheduleAutoReply(input.conversationId);
  }
}

/**
 * 访客消息入库后的 AI 自动回复钩子。
 * 只做触发，判定与调用都在 services/ai 里；失败只记日志，不影响访客发消息。
 */
function scheduleAutoReply(conversationId: string): void {
  void maybeAutoReply(conversationId).catch((error: unknown) => {
    console.error("[ai] 自动回复调度失败:", error);
  });
}
