import { randomUUID } from "node:crypto";
import type { AiJob, Prisma } from "@prisma/client";
import { prisma } from "../../lib/db";

export const AI_JOB_MAX_ATTEMPTS = 3;
export type AiJobLease = { jobId: string; jobRevision: number; leaseToken: string };
export type AiJobOutcome = { status: "COMPLETED" | "SKIPPED"; result?: Prisma.InputJsonObject };

export function aiJobLease(job: AiJob): AiJobLease {
  if (!job.leaseToken) throw new Error("AI task has no lease");
  return { jobId: job.id, jobRevision: job.revision, leaseToken: job.leaseToken };
}

/** Call inside the business transaction, after locking the conversation or knowledge entry. */
async function enqueue(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; id: string; kind: string; conversationId?: string; knowledgeId?: string; messageId?: string; payload?: object },
) {
  const payload = JSON.stringify(input.payload ?? {});
  await tx.$executeRaw`
    INSERT INTO "AiJob" ("tenantId", id, kind, "conversationId", "knowledgeId", "messageId", payload, "updatedAt", "availableAt", "createdAt")
    VALUES (${input.tenantId}, ${input.id}, ${input.kind}, ${input.conversationId ?? null}, ${input.knowledgeId ?? null},
      ${input.messageId ?? null}, ${payload}::jsonb, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
      (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
    ON CONFLICT (id) DO UPDATE SET
      "tenantId" = EXCLUDED."tenantId", "messageId" = EXCLUDED."messageId", payload = EXCLUDED.payload, revision = "AiJob".revision + 1,
      attempts = 0, "availableAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
      status = CASE WHEN "AiJob".status = 'PROCESSING' THEN 'PROCESSING' ELSE 'PENDING' END,
      "leaseToken" = CASE WHEN "AiJob".status = 'PROCESSING' THEN "AiJob"."leaseToken" ELSE NULL END,
      "lockedUntil" = CASE WHEN "AiJob".status = 'PROCESSING' THEN "AiJob"."lockedUntil" ELSE NULL END,
      "lastError" = NULL, result = NULL, "completedAt" = NULL, "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    WHERE EXCLUDED.kind = 'KNOWLEDGE_INDEX' OR "AiJob"."messageId" IS DISTINCT FROM EXCLUDED."messageId"
  `;
}

export function enqueueAiReply(tx: Prisma.TransactionClient, tenantId: string, conversationId: string, messageId: string) {
  return enqueue(tx, { tenantId, id: `reply:${conversationId}`, kind: "AUTO_REPLY", conversationId, messageId });
}

export function enqueueKnowledgeIndex(tx: Prisma.TransactionClient, tenantId: string, knowledgeId: string, useEmbeddings?: boolean) {
  return enqueue(tx, {
    tenantId, id: `index:${knowledgeId}`, kind: "KNOWLEDGE_INDEX", knowledgeId,
    payload: useEmbeddings === undefined ? {} : { useEmbeddings },
  });
}

/** Claim one task while serializing each merchant's concurrency limit on its policy row. */
export async function claimAiJob(): Promise<AiJob | null> {
  const token = randomUUID();
  return prisma.$transaction(async (tx) => {
    const candidates = await tx.$queryRaw<{ id: string; tenantId: string }[]>`
      SELECT id, "tenantId" FROM "AiJob"
      WHERE attempts < ${AI_JOB_MAX_ATTEMPTS} AND (
        (status = 'PENDING' AND "availableAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) OR
        (status = 'PROCESSING' AND "lockedUntil" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
      )
      ORDER BY "availableAt", id LIMIT 20 FOR UPDATE SKIP LOCKED
    `;
    for (const candidate of candidates) {
      await tx.$executeRaw`
        INSERT INTO "AiPolicy" ("tenantId", "updatedAt")
        VALUES (${candidate.tenantId}, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
        ON CONFLICT ("tenantId") DO NOTHING
      `;
      const policies = await tx.$queryRaw<{ concurrencyLimit: number }[]>`
        SELECT "concurrencyLimit" FROM "AiPolicy"
        WHERE "tenantId" = ${candidate.tenantId} FOR UPDATE
      `;
      const limit = Math.min(8, Math.max(1, policies[0]?.concurrencyLimit ?? 2));
      const active = await tx.aiJob.count({
        where: {
          tenantId: candidate.tenantId,
          status: "PROCESSING",
          lockedUntil: { gt: new Date() },
        },
      });
      if (active < limit) {
        return tx.aiJob.update({
          where: { id: candidate.id },
          data: {
            status: "PROCESSING",
            attempts: { increment: 1 },
            leaseToken: token,
            lockedUntil: new Date(Date.now() + 2 * 60_000),
            updatedAt: new Date(),
          },
        });
      }
      // Keep this task queued without consuming an attempt or blocking other merchants.
      await tx.aiJob.update({
        where: { id: candidate.id },
        data: { availableAt: new Date(Date.now() + 1_000) },
      });
    }
    return null;
  }, { maxWait: 5_000, timeout: 10_000 });
}

export async function renewAiJob(job: AiJob): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "AiJob" SET "lockedUntil" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '2 minutes'
    WHERE id = ${job.id} AND status = 'PROCESSING' AND "leaseToken" = ${job.leaseToken}
      AND "lockedUntil" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
  `;
}

export async function lockAiJobLease(tx: Prisma.TransactionClient, lease: AiJobLease): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "AiJob" WHERE id = ${lease.jobId} AND revision = ${lease.jobRevision}
      AND "leaseToken" = ${lease.leaseToken} AND status = 'PROCESSING'
      AND "lockedUntil" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') FOR UPDATE
  `;
  return rows.length === 1;
}

export async function finishAiJob(job: AiJob, outcome: AiJobOutcome | Error): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<AiJob[]>`
      SELECT * FROM "AiJob" WHERE id = ${job.id} AND status = 'PROCESSING' AND "leaseToken" = ${job.leaseToken}
        AND "lockedUntil" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') FOR UPDATE
    `;
    const current = rows[0];
    if (!current) return;
    const superseded = current.revision !== job.revision;
    const failed = outcome instanceof Error;
    const retry = failed && job.attempts < AI_JOB_MAX_ATTEMPTS;
    await tx.aiJob.update({
      where: { id: job.id },
      data: {
        status: superseded || retry ? "PENDING" : failed ? "FAILED" : outcome.status,
        attempts: superseded ? 0 : undefined,
        availableAt: new Date(Date.now() + (!superseded && retry ? 5000 * 2 ** (job.attempts - 1) : 0)),
        leaseToken: null,
        lockedUntil: null,
        completedAt: superseded || retry ? null : new Date(),
        lastError: !superseded && failed ? outcome.message.slice(0, 500) : null,
        ...(!superseded && !failed ? { result: outcome.result ?? {} } : {}),
      },
    });
  });
}

export async function expireAiJobs(): Promise<void> {
  await prisma.aiJob.updateMany({
    where: { status: "PROCESSING", attempts: { gte: AI_JOB_MAX_ATTEMPTS }, lockedUntil: { lte: new Date() } },
    data: { status: "FAILED", leaseToken: null, lockedUntil: null, completedAt: new Date(), lastError: "AI task lease expired after final attempt" },
  });
}
