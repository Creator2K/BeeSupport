import type { Prisma } from "@prisma/client";

import { prisma } from "../../lib/db";

const DAY_MS = 86_400_000;
const BATCH_SIZE = 500;
// One pass removes at most this many rows per table. A backlog is worked off
// over the following hourly passes instead of in one long burst.
const MAX_ROWS_PER_RUN = 20_000;

export type RetentionOptions = {
  now?: Date;
  shouldStop?: () => boolean;
  maxRows?: number;
};

const cutoffFor = (days: number, options: RetentionOptions) =>
  new Date((options.now ?? new Date()).getTime() - days * DAY_MS);

async function removeAged(
  days: number,
  options: RetentionOptions,
  list: (cutoff: Date, take: number) => Promise<{ id: string }[]>,
  remove: (ids: string[]) => Promise<{ count: number }>,
): Promise<number> {
  if (days <= 0) return 0;
  const cutoff = cutoffFor(days, options);
  const limit = options.maxRows ?? MAX_ROWS_PER_RUN;
  let removed = 0;
  while (removed < limit && !options.shouldStop?.()) {
    const batch = await list(cutoff, Math.min(BATCH_SIZE, limit - removed));
    if (!batch.length) break;
    const { count } = await remove(batch.map((row) => row.id));
    removed += count;
    // Nothing deleted means another instance got there first: leave the rest to it.
    if (batch.length < BATCH_SIZE || !count) break;
  }
  return removed;
}

/** Removes block records older than `days` days. 0 keeps everything. */
export function cleanupRiskEvents(
  days: number,
  options: RetentionOptions = {},
): Promise<number> {
  return removeAged(
    days,
    options,
    (cutoff, take) =>
      prisma.riskEvent.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take,
      }),
    (ids) => prisma.riskEvent.deleteMany({ where: { id: { in: ids } } }),
  );
}

/** Removes audit rows of every tenant older than `days` days. 0 keeps everything. */
export function cleanupAuditLogs(
  days: number,
  options: RetentionOptions = {},
): Promise<number> {
  return removeAged(
    days,
    options,
    (cutoff, take) =>
      prisma.auditLog.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take,
      }),
    (ids) => prisma.auditLog.deleteMany({ where: { id: { in: ids } } }),
  );
}

/**
 * Removes visitors who only ever browsed: no conversation, no email or name,
 * not blocked, nothing an agent wrote on the profile, and not seen for `days`
 * days. 0 keeps everything.
 */
export async function cleanupAnonymousVisitors(
  days: number,
  options: RetentionOptions = {},
): Promise<number> {
  if (days <= 0) return 0;
  const idle = {
    lastSeenAt: { lt: cutoffFor(days, options) },
    email: "",
    name: null,
    blocked: false,
    profileNote: null,
    pendingImageId: null,
    profileTags: { isEmpty: true },
    conversations: { none: {} },
  } satisfies Prisma.VisitorWhereInput;
  const limit = options.maxRows ?? MAX_ROWS_PER_RUN;
  let removed = 0;
  let after: string | undefined;
  while (removed < limit && !options.shouldStop?.()) {
    const batch = await prisma.visitor.findMany({
      where: after ? { ...idle, id: { gt: after } } : idle,
      select: { id: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });
    for (const { id } of batch) {
      if (removed >= limit || options.shouldStop?.()) return removed;
      removed += await prisma.$transaction(async (tx) => {
        // Deleting a visitor cascades to its conversations. Starting a
        // conversation takes this row lock first, so the conditions are
        // checked again under the same lock: a conversation created a moment
        // ago is seen here instead of being removed with the visitor.
        await tx.$queryRaw`SELECT id FROM "Visitor" WHERE id = ${id} FOR UPDATE`;
        return (await tx.visitor.deleteMany({ where: { ...idle, id } })).count;
      });
    }
    if (batch.length < BATCH_SIZE) break;
    after = batch[batch.length - 1]!.id;
  }
  return removed;
}
