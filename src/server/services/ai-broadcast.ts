import { broadcastConversation, broadcastMessage } from "./broadcast";

/** A notification failure must not turn a committed AI action into a failed write. */
export async function broadcastAiUpdate(conversationId: string, messageId?: string) {
  const results = await Promise.allSettled([
    broadcastConversation(conversationId),
    ...(messageId ? [broadcastMessage(messageId)] : []),
  ]);
  for (const result of results) {
    if (result.status === "rejected")
      console.error("[ai] 更新已保存，但实时通知失败：", result.reason);
  }
}
