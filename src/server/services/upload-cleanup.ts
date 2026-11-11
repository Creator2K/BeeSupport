import { prisma } from "../../lib/db";
import { logger } from "../../lib/logger";
import { deleteUpload } from "../../lib/storage";

export const UNSENT_UPLOAD_RETENTION_MS = 24 * 60 * 60_000;
const BATCH_SIZE = 200;

/**
 * Uploads that were never attached to a message still count against the
 * tenant's storage quota. Removing them after a day stops abandoned or
 * abusive uploads from holding that space. Same cutoff as
 * `pnpm uploads:cleanup`, which additionally sweeps orphaned files on disk.
 */
export async function cleanupUnsentAttachments(
  options: { now?: Date; shouldStop?: () => boolean } = {},
): Promise<number> {
  const cutoff = new Date(
    (options.now ?? new Date()).getTime() - UNSENT_UPLOAD_RETENTION_MS,
  );
  let removed = 0;
  while (!options.shouldStop?.()) {
    const batch = await prisma.attachment.findMany({
      where: { messageId: null, createdAt: { lt: cutoff } },
      select: { id: true, storageKey: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });
    let progressed = false;
    for (const attachment of batch) {
      // Repeat the condition in the delete: the upload may have been sent, or
      // removed by another instance, since it was listed.
      const deleted = await prisma.attachment.deleteMany({
        where: {
          id: attachment.id,
          messageId: null,
          createdAt: { lt: cutoff },
        },
      });
      if (!deleted.count) continue;
      progressed = true;
      removed += 1;
      await deleteUpload(attachment.storageKey).catch((error: unknown) =>
        logger.error(
          "uploads.unsent_file_delete_failed",
          { attachmentId: attachment.id },
          error,
        ),
      );
    }
    if (batch.length < BATCH_SIZE || !progressed) break;
  }
  return removed;
}
