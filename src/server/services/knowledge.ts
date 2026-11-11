import type { AiJob } from "@prisma/client";
import { chunkText, invalidateKnowledgeCache, embedTexts, getAiConfig } from "../../lib/ai";
import { prisma } from "../../lib/db";
import { aiJobLease, enqueueKnowledgeIndex, lockAiJobLease, type AiJobOutcome } from "./ai-job-queue";

const EMBED_BATCH_SIZE = 16;

/** Manual rebuild requests persist work; the HTTP request never waits for a model. */
export async function requestKnowledgeIndex(input?: { knowledgeId?: string; useEmbeddings?: boolean }) {
  return prisma.$transaction(async (tx) => {
    const entries = await tx.aiKnowledge.findMany({
      where: input?.knowledgeId ? { id: input.knowledgeId } : {},
      select: { id: true, tenantId: true },
      orderBy: { id: "asc" },
    });
    let queued = 0;
    for (const entry of entries) {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "AiKnowledge" WHERE id = ${entry.id} FOR UPDATE`;
      if (!rows.length) continue;
      await enqueueKnowledgeIndex(tx, entry.tenantId, entry.id, input?.useEmbeddings);
      queued += 1;
    }
    return { queued };
  });
}

/** Build outside a transaction, then fence the short replacement transaction with the task lease. */
export async function processKnowledgeIndex(job: AiJob): Promise<AiJobOutcome> {
  if (!job.knowledgeId) throw new Error("Invalid knowledge indexing task");
  const entry = await prisma.aiKnowledge.findUnique({
    where: { id: job.knowledgeId },
    select: { id: true, title: true, content: true, updatedAt: true },
  });
  if (!entry) return { status: "SKIPPED", result: { reason: "knowledge_deleted" } };
  const startedAt = Date.now();
  const config = await getAiConfig();
  const requested = job.payload as { useEmbeddings?: boolean };
  const canEmbed = requested.useEmbeddings ?? config.enableEmbeddings;
  const pieces = chunkText(`${entry.title}\n${entry.content}`);
  const texts = pieces.length ? pieces : [entry.content.slice(0, 400)];
  const embeddings: number[][] = [];
  if (canEmbed) {
    for (let index = 0; index < texts.length; index += EMBED_BATCH_SIZE) {
      // Provider errors reach the durable worker for bounded retries. Existing content remains searchable.
      embeddings.push(...await embedTexts(config, texts.slice(index, index + EMBED_BATCH_SIZE)));
    }
  }

  const result = {
    entries: 1, chunks: texts.length, embedded: embeddings.length,
    vectorized: embeddings.length > 0, durationMs: Date.now() - startedAt,
  };

  const applied = await prisma.$transaction(async (tx) => {
    const entries = await tx.$queryRaw<{ updatedAt: Date }[]>`SELECT "updatedAt" FROM "AiKnowledge" WHERE id = ${entry.id} FOR UPDATE`;
    if (!entries.length || entries[0].updatedAt.getTime() !== entry.updatedAt.getTime() ||
        !(await lockAiJobLease(tx, aiJobLease(job)))) return false;
    await tx.aiKnowledgeChunk.deleteMany({ where: { knowledgeId: entry.id } });
    await tx.aiKnowledgeChunk.createMany({
      data: texts.map((content, index) => ({
        knowledgeId: entry.id, index, content,
        embedding: embeddings[index] ?? [],
        embeddingModel: embeddings[index] ? config.embeddingModel : null,
      })),
    });
    // Retrieval caches on every instance observe this version change.
    await tx.aiKnowledge.update({ where: { id: entry.id }, data: { updatedAt: new Date() } });
    await tx.aiJob.update({
      where: { id: job.id },
      data: { status: "COMPLETED", result, completedAt: new Date(), leaseToken: null, lockedUntil: null, lastError: null },
    });
    return true;
  });
  if (!applied) return { status: "SKIPPED", result: { reason: "newer_revision_or_lost_lease" } };
  invalidateKnowledgeCache();
  return { status: "COMPLETED", result };
}

export async function knowledgeIndexStats() {
  const [entries, chunks, vectorized, pending, processing, failed] = await Promise.all([
    prisma.aiKnowledge.count(),
    prisma.aiKnowledgeChunk.count(),
    prisma.aiKnowledgeChunk.count({ where: { NOT: { embeddingModel: null } } }),
    prisma.aiJob.count({ where: { kind: "KNOWLEDGE_INDEX", status: "PENDING" } }),
    prisma.aiJob.count({ where: { kind: "KNOWLEDGE_INDEX", status: "PROCESSING" } }),
    prisma.aiJob.count({ where: { kind: "KNOWLEDGE_INDEX", status: "FAILED" } }),
  ]);
  return { entries, chunks, vectorized, pending, processing, failed };
}
