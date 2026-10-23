import {
  chunkText,
  invalidateKnowledgeCache,
  embedTexts,
  getAiConfig,
  type AiConfig,
} from "../../lib/ai";
import { prisma } from "../../lib/db";

export type RebuildIndexResult = {
  entries: number;
  chunks: number;
  embedded: number;
  /** 向量是否真的写进去了（没开 embedding 或没配向量模型时为 false） */
  vectorized: boolean;
  model: string | null;
  durationMs: number;
};

/** 单次 embedding 请求的最大文本数，避免部分网关限制 */
const EMBED_BATCH_SIZE = 16;

/**
 * 重建知识库切片索引。
 * - 始终重建切片（关键词检索依赖它）；
 * - 配置里开了 embedding 且能调到向量接口时，顺便写入向量。
 */
export async function rebuildKnowledgeIndex(input?: {
  knowledgeId?: string;
  config?: AiConfig;
}): Promise<RebuildIndexResult> {
  const startedAt = Date.now();
  const config = input?.config ?? (await getAiConfig());

  const entries = await prisma.aiKnowledge.findMany({
    where: input?.knowledgeId ? { id: input.knowledgeId } : {},
    select: { id: true, title: true, content: true },
  });

  let chunkCount = 0;
  let embeddedCount = 0;
  const canEmbed = Boolean(
    config.enableEmbeddings &&
    config.baseUrl &&
    config.apiKey &&
    config.embeddingModel,
  );

  for (const entry of entries) {
    const pieces = chunkText(`${entry.title}\n${entry.content}`);
    const texts = pieces.length > 0 ? pieces : [entry.content.slice(0, 400)];

    let embeddings: number[][] = [];
    if (canEmbed) {
      try {
        for (let index = 0; index < texts.length; index += EMBED_BATCH_SIZE) {
          const batch = texts.slice(index, index + EMBED_BATCH_SIZE);
          const vectors = await embedTexts(config, batch);
          embeddings.push(...vectors);
        }
        if (embeddings.length !== texts.length) embeddings = [];
      } catch (error) {
        console.error(
          `[ai] 知识库「${entry.title}」向量化失败，仅重建关键词索引：`,
          error instanceof Error ? error.message : error,
        );
        embeddings = [];
      }
    }

    await prisma.$transaction([
      prisma.aiKnowledgeChunk.deleteMany({ where: { knowledgeId: entry.id } }),
      prisma.aiKnowledgeChunk.createMany({
        data: texts.map((content, index) => ({
          knowledgeId: entry.id,
          index,
          content,
          embedding: embeddings[index] ?? [],
          embeddingModel: embeddings[index] ? config.embeddingModel : null,
        })),
      }),
    ]);

    invalidateKnowledgeCache();
    chunkCount += texts.length;
    embeddedCount += embeddings.filter((vector) => vector.length > 0).length;
  }

  return {
    entries: entries.length,
    chunks: chunkCount,
    embedded: embeddedCount,
    vectorized: embeddedCount > 0,
    model: embeddedCount > 0 ? config.embeddingModel : null,
    durationMs: Date.now() - startedAt,
  };
}

/** 知识库内容变更后自动重建该条目的切片（不阻塞主流程） */
export function scheduleKnowledgeIndexRebuild(knowledgeId: string): void {
  void rebuildKnowledgeIndex({ knowledgeId }).catch((error: unknown) => {
    console.error("[ai] 知识库切片重建失败:", error);
  });
}

/** 索引概况（后台展示用） */
export async function knowledgeIndexStats(): Promise<{
  entries: number;
  chunks: number;
  vectorized: number;
}> {
  const [entries, chunks, vectorized] = await Promise.all([
    prisma.aiKnowledge.count(),
    prisma.aiKnowledgeChunk.count(),
    prisma.aiKnowledgeChunk.count({ where: { NOT: { embeddingModel: null } } }),
  ]);
  return { entries, chunks, vectorized };
}
