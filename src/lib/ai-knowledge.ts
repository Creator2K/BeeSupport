import { prisma } from "./db";
import {
  DEFAULT_SYSTEM_PROMPT,
  type AiConfig,
} from "./ai-config";
import { embedTexts, type AiMessage } from "./ai-provider";

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/* ---------------- 知识库：切片 + 召回 ---------------- */

export const CHUNK_MAX_CHARS = 420;
export const CHUNK_OVERLAP_CHARS = 60;

/**
 * 按段落切片，超长段落再按句子/硬切分，保留少量重叠避免语义被切断。
 */
export function chunkText(
  content: string,
  options: { maxChars?: number; overlap?: number } = {},
): string[] {
  const maxChars = Math.max(80, options.maxChars ?? CHUNK_MAX_CHARS);
  const overlap = Math.max(
    0,
    Math.min(options.overlap ?? CHUNK_OVERLAP_CHARS, maxChars / 2),
  );
  const text = content.replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const pieces: string[] = [];
  for (const block of blocks) {
    if (block.length <= maxChars) {
      pieces.push(block);
      continue;
    }
    // 长段落按句子切，句子还长就硬切
    const sentences = block.split(/(?<=[。！？；.!?;])/).filter(Boolean);
    let buffer = "";
    for (const sentence of sentences) {
      if (sentence.length > maxChars) {
        if (buffer) {
          pieces.push(buffer);
          buffer = "";
        }
        for (
          let index = 0;
          index < sentence.length;
          index += maxChars - overlap
        ) {
          pieces.push(sentence.slice(index, index + maxChars));
        }
        continue;
      }
      if ((buffer + sentence).length > maxChars) {
        if (buffer) pieces.push(buffer);
        buffer = sentence;
      } else {
        buffer += sentence;
      }
    }
    if (buffer) pieces.push(buffer);
  }

  // 合并过短的碎片，避免产生一堆无意义切片
  const merged: string[] = [];
  for (const piece of pieces) {
    const last = merged[merged.length - 1];
    if (last && last.length + piece.length + 1 <= maxChars) {
      merged[merged.length - 1] = `${last}\n${piece}`;
    } else {
      merged.push(piece);
    }
  }

  return merged.map((piece) => piece.slice(0, maxChars * 2));
}

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

function scoreKeyword(candidate: KnowledgeCandidate, query: string): number {
  const haystack = query.toLowerCase();
  const tokens = tokenize(query);
  let score = 0;

  for (const keyword of candidate.keywords) {
    const needle = keyword.trim().toLowerCase();
    if (needle && haystack.includes(needle)) score += 6;
    else if (needle && tokens.includes(needle)) score += 4;
  }

  const title = candidate.title.toLowerCase();
  if (title && haystack.includes(title)) score += 4;
  for (const token of tokenize(candidate.title)) {
    if (tokens.includes(token)) score += 1.5;
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

async function fetchKnowledgeEntries(siteId: string | null) {
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
          embedding: true,
          embeddingModel: true,
        },
        orderBy: { index: "asc" },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
}

async function loadKnowledgeEntries(siteId: string | null) {
  const key = siteId ?? "*";
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
  const entries = await fetchKnowledgeEntries(siteId);
  const bytes = entries.reduce(
    (sum, entry) =>
      sum +
      entry.content.length * 2 +
      entry.chunks.reduce(
        (size, chunk) =>
          size + chunk.content.length * 2 + chunk.embedding.length * 8,
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
  const entries = await loadKnowledgeEntries(input.siteId);

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
          !input.config || chunk.embeddingModel === input.config.embeddingModel
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
      console.error(
        "[ai] 向量检索失败，回退关键词：",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const scored = candidates.map((candidate) => {
    const keywordScore = scoreKeyword(candidate, input.query);
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

export function buildSystemPrompt(input: {
  config: AiConfig;
  siteName: string;
  knowledge: Pick<KnowledgeHit, "title" | "content">[];
}): string {
  const base = (input.config.systemPrompt || DEFAULT_SYSTEM_PROMPT).replace(
    /\{siteName\}/g,
    input.siteName,
  );

  if (input.knowledge.length === 0) {
    return `${base}\n\n知识库：暂无匹配内容，遇到具体政策或价格请让访客留言给人工客服。`;
  }

  const context = input.knowledge
    .map((entry, index) => `【${index + 1}】${entry.title}\n${entry.content}`)
    .join("\n\n");

  return `${base}\n\n知识库（按相关度排序，优先使用）：\n${context}`;
}

/** 把会话历史转成模型消息（跳过内部备注与系统消息） */
export function toAiMessages(
  rows: {
    sender: "VISITOR" | "AGENT" | "SYSTEM" | "AI";
    type: string;
    body: string;
    authorName: string | null;
  }[],
  limit: number,
): AiMessage[] {
  return rows
    .filter(
      (row) => row.type !== "NOTE" && row.type !== "SYSTEM" && row.body.trim(),
    )
    .slice(-limit)
    .map((row) => {
      if (row.sender === "VISITOR") {
        return { role: "user" as const, content: row.body };
      }
      if (row.sender === "AI") {
        return { role: "assistant" as const, content: row.body };
      }
      if (row.sender === "AGENT") {
        return {
          role: "assistant" as const,
          content: `${row.authorName ?? "客服"}：${row.body}`,
        };
      }
      return { role: "system" as const, content: row.body };
    });
}
