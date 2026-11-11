import { prisma } from "../../lib/db";
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
}
