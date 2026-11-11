import { prisma } from "./db";
import { logger } from "./logger";
import type { AiConfig } from "./ai-config";
import { embedTexts } from "./ai-provider";
import { cosineSimilarity } from "./ai-text";

type KnowledgeCandidate = {
  id: string;
  knowledgeId: string;
  title: string;
  content: string;
  keywords: string[];
  embedding: number[];
};

export type KnowledgeHit = {
  id: string;
  knowledgeId: string;
  title: string;
  content: string;
  score: number;
  /** 命中来源：关键词 / 向量 */
  via: "keyword" | "vector" | "hybrid";
};

function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens = new Set<string>();
  // 英文/数字按词，中文按 2-gram（不引入分词依赖）
  for (const word of lower.match(/[a-z0-9]{2,}/g) ?? []) tokens.add(word);
  const cjk = lower.match(/[\u4e00-\u9fa5]+/g) ?? [];
  for (const block of cjk) {
    for (let index = 0; index < block.length - 1; index += 1) {
      tokens.add(block.slice(index, index + 2));
    }
  }
  return [...tokens];
}

function scoreKeyword(
  candidate: KnowledgeCandidate,
  haystack: string,
  tokens: Set<string>,
): number {
  let score = 0;

  for (const keyword of candidate.keywords) {
    const needle = keyword.trim().toLowerCase();
    if (needle && haystack.includes(needle)) score += 6;
    else if (needle && tokens.has(needle)) score += 4;
  }

  const title = candidate.title.toLowerCase();
  if (title && haystack.includes(title)) score += 4;
  for (const token of tokenize(candidate.title)) {
    if (tokens.has(token)) score += 1.5;
  }

  const body = candidate.content.toLowerCase();
  let hits = 0;
  for (const token of tokens) {
    if (body.includes(token)) hits += 1;
  }
  score += Math.min(6, hits * 0.4);

  return score;
}

/**
 * 混合召回：关键词打分 + （可选）向量余弦相似度。
 * 启用 embedding 且条目已建索引时，向量分权重更高。
 */
const knowledgeCache = new Map<
  string,
  {
    expiresAt: number;
    bytes: number;
    signature: string;
    entries: Awaited<ReturnType<typeof fetchKnowledgeEntries>>;
  }
>();

export function invalidateKnowledgeCache(): void {
  knowledgeCache.clear();
}

async function fetchKnowledgeEntries(siteId: string, withEmbeddings: boolean) {
  return prisma.aiKnowledge.findMany({
    where: {
      enabled: true,
      tenant: { sites: { some: { id: siteId ?? "__none__" } } },
      OR: [{ siteId: null }, ...(siteId ? [{ siteId }] : [])],
    },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      content: true,
      keywords: true,
      chunks: {
        select: {
          id: true,
          content: true,
          embedding: withEmbeddings,
          embeddingModel: withEmbeddings,
        },
        orderBy: { index: "asc" },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
}

async function loadKnowledgeEntries(siteId: string, withEmbeddings: boolean) {
  const key = JSON.stringify([siteId, withEmbeddings]);
  // Refresh cheap authorization/version metadata on every lookup, including across instances.
  const metadata = await prisma.aiKnowledge.findMany({
    where: {
      enabled: true,
      tenant: { sites: { some: { id: siteId ?? "__none__" } } },
      OR: [{ siteId: null }, ...(siteId ? [{ siteId }] : [])],
    },
    select: { id: true, updatedAt: true },
    orderBy: { id: "asc" },
  });
  const signatureOf = (rows: { id: string; updatedAt: Date }[]) =>
    rows
      .map((entry) => `${entry.id}:${entry.updatedAt.toISOString()}`)
      .sort()
      .join("|");
  const signature = signatureOf(metadata);
  const cached = knowledgeCache.get(key);
  if (cached && cached.expiresAt > Date.now() && cached.signature === signature)
    return cached.entries;
  knowledgeCache.delete(key);
  const entries = await fetchKnowledgeEntries(siteId, withEmbeddings);
  const bytes = entries.reduce(
    (sum, entry) =>
      sum +
      entry.content.length * 2 +
      entry.chunks.reduce(
        (size, chunk) =>
          size + chunk.content.length * 2 + (chunk.embedding?.length ?? 0) * 8,
        0,
      ),
    0,
  );
  // Bound both the number and memory size of cached sites; large libraries are not retained.
  if (bytes <= 8 * 1024 * 1024) {
    let retained = [...knowledgeCache.values()].reduce(
      (sum, value) => sum + value.bytes,
      0,
    );
    while (
      knowledgeCache.size &&
      (knowledgeCache.size >= 8 || retained + bytes > 32 * 1024 * 1024)
    ) {
      const oldest = knowledgeCache.keys().next().value!;
      retained -= knowledgeCache.get(oldest)!.bytes;
      knowledgeCache.delete(oldest);
    }
    knowledgeCache.set(key, {
      expiresAt: Date.now() + 30_000,
      bytes,
      entries,
      signature: signatureOf(entries),
    });
  }
  return entries;
}

export async function retrieveKnowledge(input: {
  siteId: string | null;
  query: string;
  topK: number;
  config?: AiConfig;
}): Promise<KnowledgeHit[]> {
  if (!input.siteId || input.topK <= 0 || !input.query.trim()) return [];
  const entries = await loadKnowledgeEntries(
    input.siteId,
    Boolean(input.config?.enableEmbeddings),
  );

  if (entries.length === 0 || input.topK <= 0) return [];

  const candidates: KnowledgeCandidate[] = [];
  for (const entry of entries) {
    if (entry.chunks.length === 0) {
      // 还没有切片的条目（例如刚升级上来）直接用整篇内容兜底
      candidates.push({
        id: entry.id,
        knowledgeId: entry.id,
        title: entry.title,
        content: entry.content,
        keywords: entry.keywords,
        embedding: [],
      });
      continue;
    }
    for (const chunk of entry.chunks) {
      candidates.push({
        id: chunk.id,
        knowledgeId: entry.id,
        title: entry.title,
        content: chunk.content,
        keywords: entry.keywords,
        embedding:
          input.config?.enableEmbeddings &&
          chunk.embeddingModel === input.config.embeddingModel
            ? (chunk.embedding ?? [])
            : [],
      });
    }
  }

  let queryEmbedding: number[] | null = null;
  const config = input.config;
  const hasVectors = candidates.some(
    (candidate) => candidate.embedding.length > 0,
  );

  if (config?.enableEmbeddings && hasVectors) {
    try {
      const [vector] = await embedTexts(config, [input.query]);
      queryEmbedding = vector ?? null;
    } catch (error) {
      logger.error("ai.vector_search_failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const queryLower = input.query.toLowerCase();
  const queryTokens = new Set(tokenize(input.query));
  const scored = candidates.map((candidate) => {
    const keywordScore = scoreKeyword(candidate, queryLower, queryTokens);
    let vectorScore = 0;

    if (
      queryEmbedding &&
      candidate.embedding.length === queryEmbedding.length
    ) {
      const similarity = cosineSimilarity(queryEmbedding, candidate.embedding);
      if (similarity > 0.2) vectorScore = similarity * 12;
    }

    const score = keywordScore + vectorScore;
    const via: KnowledgeHit["via"] =
      vectorScore > 0 && keywordScore > 0
        ? "hybrid"
        : vectorScore > 0
          ? "vector"
          : "keyword";

    return { candidate, score, via };
  });

  const threshold = queryEmbedding ? 0.5 : 0;
  const matched = scored
    .filter((item) => item.score > threshold)
    .sort((a, b) => b.score - a.score);

  // 同一篇知识最多取 2 片，保证覆盖面
  const perKnowledge = new Map<string, number>();
  const hits: KnowledgeHit[] = [];
  for (const item of matched) {
    const used = perKnowledge.get(item.candidate.knowledgeId) ?? 0;
    if (used >= 2) continue;
    perKnowledge.set(item.candidate.knowledgeId, used + 1);
    hits.push({
      id: item.candidate.id,
      knowledgeId: item.candidate.knowledgeId,
      title: item.candidate.title,
      content: item.candidate.content,
      score: Math.round(item.score * 100) / 100,
      via: item.via,
    });
    if (hits.length >= input.topK) break;
  }

  return hits;
}
