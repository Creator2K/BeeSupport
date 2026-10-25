import { Prisma } from "@prisma/client";

import type { SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import {
  deliveryDiagnostic,
  deliveryKinds,
  deliveryState,
} from "../../lib/deliveries";
import { operationWindow } from "../../lib/operations";
import { assertPlatform, stateWhere } from "./delivery-shared";

export async function getDeliveries(
  actor: SessionUser,
  input: {
    days?: number;
    state?: string;
    kind?: string;
    search?: string;
    page?: number;
  },
  now = new Date(),
) {
  assertPlatform(actor);
  const days = [7, 30, 90].includes(input.days ?? 7) ? (input.days ?? 7) : 7;
  const base: Prisma.NotificationJobWhereInput = {
    createdAt: { gte: operationWindow(days, now).start, lte: now },
    ...(input.kind && Object.hasOwn(deliveryKinds, input.kind)
      ? { kind: input.kind }
      : {}),
    ...(input.search?.trim()
      ? {
          id: {
            contains: input.search.trim().slice(0, 100),
            mode: "insensitive",
          },
        }
      : {}),
  };
  const where = { AND: [base, stateWhere(input.state ?? "")] };
  const pageSize = 20;
  return prisma.$transaction(
    async (tx) => {
      const [total, groups, overdue] = await Promise.all([
        tx.notificationJob.count({ where }),
        tx.notificationJob.groupBy({
          by: ["status", "outcome"],
          where: base,
          _count: { _all: true },
        }),
        tx.notificationJob.count({
          where: {
            AND: [
              base,
              {
                OR: [
                  {
                    status: "PENDING",
                    availableAt: { lt: new Date(now.getTime() - 300000) },
                  },
                  { status: "PROCESSING", lockedUntil: { lt: now } },
                ],
              },
            ],
          },
        }),
      ]);
      const page = Math.min(
        Math.max(1, Math.min(100000, Number(input.page) || 1)) | 0,
        Math.max(1, Math.ceil(total / pageSize)),
      );
      const rows = await tx.notificationJob.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        // No payload, ciphertext, recipient address, endpoint URL or lease token leaves this service.
        select: {
          id: true,
          kind: true,
          status: true,
          outcome: true,
          attempts: true,
          totalAttempts: true,
          manualRetries: true,
          createdAt: true,
          updatedAt: true,
          availableAt: true,
          completedAt: true,
          lastError: true,
        },
      });
      const counts: Record<string, number> = {
        PENDING: 0,
        PROCESSING: 0,
        FAILED: 0,
        SUCCESS: 0,
        SKIPPED: 0,
        LEGACY: 0,
        UNKNOWN: 0,
      };
      for (const row of groups) counts[deliveryState(row)] += row._count._all;
      return {
        days,
        page,
        pageSize,
        total,
        counts,
        overdue,
        rows: rows.map((row) => ({
          id: row.id,
          kind: Object.hasOwn(deliveryKinds, row.kind) ? row.kind : "UNKNOWN",
          state: deliveryState(row),
          attempts: row.attempts,
          totalAttempts: Math.max(row.totalAttempts, row.attempts),
          manualRetries: row.manualRetries,
          diagnostic: deliveryDiagnostic(row.lastError, deliveryState(row)),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          availableAt: row.availableAt.toISOString(),
          completedAt: row.completedAt?.toISOString() ?? null,
          canRetry:
            row.status === "FAILED" && Object.hasOwn(deliveryKinds, row.kind),
        })),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export type DeliveryList = Awaited<ReturnType<typeof getDeliveries>>;
