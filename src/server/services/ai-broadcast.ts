import { logger } from "../../lib/logger";
import { broadcastConversation, broadcastMessage } from "./broadcast";

/** A notification failure must not turn a committed AI action into a failed write. */
export async function broadcastAiUpdate(conversationId: string, messageId?: string) {
  const results = await Promise.allSettled([
    broadcastConversation(conversationId),
    ...(messageId ? [broadcastMessage(messageId)] : []),
  ]);
  for (const result of results) {
    if (result.status === "rejected")
      logger.error(
        "ai.broadcast_failed",
        { conversationId, messageId },
        result.reason,
      );
  }
}
