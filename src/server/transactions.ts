import type { Prisma } from "@prisma/client";

/** Serialize message writes, read receipts and AI commits for this conversation. */
export async function lockConversation(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${id} FOR UPDATE`;
}
