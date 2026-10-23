import { prisma } from "./db";

/**
 * AI 助手：任意 OpenAI 兼容接口（/v1/chat/completions、/v1/models、/v1/embeddings）。
 * 配置存在 Setting(key="ai")，环境变量只作为首次默认值。
 *
 * 三块能力：
 * 1. 多模型：models 是可用模型清单，model 是默认模型；
 * 2. 知识库 RAG：条目自动切片，可选 embedding 向量 + 关键词混合召回；
 * 3. 工具调用：OpenAI 的 function calling，允许模型自己去查知识库/访客资料。
 */
export const AI_SETTING_KEY = "ai";

export type AiAutoReply = "off" | "no_agent" | "always";

export type AiConfig = {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  /** 默认模型 */
  model: string;
  /** 可在工作台切换的模型清单 */
  models: string[];
  assistantName: string;
  systemPrompt: string;
  autoReply: AiAutoReply;
  temperature: number;
  maxTokens: number;
  topK: number;
  historyLimit: number;
  /** 知识库向量检索 */
  enableEmbeddings: boolean;
  embeddingModel: string;
  /** 工具调用 */
  enableTools: boolean;
  maxToolRounds: number;
};

export const DEFAULT_SYSTEM_PROMPT = [
  "你是 {siteName} 的在线客服助手。",
  "要求：",
  "1. 用简体中文回答，语气自然、简洁，控制在 3 句话以内；",
  "2. 只依据知识库与对话内容回答，不知道就直说并建议留言给人工客服；",
  "3. 不要编造价格、政策、时间等具体信息；",
  "4. 不要输出 Markdown 表格或代码块。",
].join("\n");

export function defaultAiConfig(): AiConfig {
  const model = process.env.OPENAI_MODEL ?? "";
  return {
    enabled: false,
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model,
    models: model ? [model] : [],
    assistantName: "智能助手",
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    autoReply: "off",
    temperature: 0.3,
    maxTokens: 600,
    topK: 4,
    historyLimit: 12,
    enableEmbeddings: false,
    embeddingModel:
      process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
    enableTools: true,
    maxToolRounds: 4,
  };
}

export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiError";
  }
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  // 允许用户只填域名，自动补 /v1
  if (/\/v\d+$/.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getAiConfig(): Promise<AiConfig> {
  const defaults = defaultAiConfig();

  try {
    const setting = await prisma.setting.findUnique({
      where: { key: AI_SETTING_KEY },
    });
    if (!setting?.value) return defaults;

    const stored = setting.value as Partial<AiConfig>;
    const model =
      typeof stored.model === "string" ? stored.model : defaults.model;
    const models = Array.isArray(stored.models)
      ? stored.models.filter((item): item is string => typeof item === "string")
      : model
        ? [model]
        : [];

    return {
      ...defaults,
      ...stored,
      baseUrl: normalizeBaseUrl(stored.baseUrl ?? defaults.baseUrl),
      model,
      models: models.length > 0 ? Array.from(new Set(models)) : models,
      temperature: toNumber(stored.temperature, defaults.temperature),
      maxTokens: toNumber(stored.maxTokens, defaults.maxTokens),
      topK: toNumber(stored.topK, defaults.topK),
      historyLimit: toNumber(stored.historyLimit, defaults.historyLimit),
      maxToolRounds: Math.min(
        8,
        Math.max(1, toNumber(stored.maxToolRounds, defaults.maxToolRounds)),
      ),
      enableTools: stored.enableTools ?? defaults.enableTools,
      enableEmbeddings: stored.enableEmbeddings ?? defaults.enableEmbeddings,
      embeddingModel: stored.embeddingModel?.trim() || defaults.embeddingModel,
      autoReply: (stored.autoReply ?? defaults.autoReply) as AiAutoReply,
    };
  } catch (error) {
    console.error("[ai] 读取配置失败:", error);
    return defaults;
  }
}

export function isAiReady(config: AiConfig): boolean {
  return Boolean(
    config.enabled && config.baseUrl && config.apiKey && config.model,
  );
}

/** 可切换的模型清单：至少包含默认模型 */
export function availableModels(config: AiConfig): string[] {
  const list = [...config.models];
  if (config.model && !list.includes(config.model)) list.unshift(config.model);
  return list;
}

export function resolveModel(config: AiConfig, requested?: string): string {
  const wanted = requested?.trim();
  if (!wanted) return config.model;
  return availableModels(config).includes(wanted) ? wanted : config.model;
}

/* ---------------- 模型列表 ---------------- */

/** 拉取模型列表，用于后台的模型下拉 */
export async function listAiModels(config: {
  baseUrl: string;
  apiKey: string;
}): Promise<string[]> {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  if (!baseUrl || !config.apiKey) {
    throw new AiError("请先填写接口地址与 API 密钥");
  }

  const response = await fetch(`${baseUrl}/models`, {
    headers: { authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(20_000),
  }).catch((error: unknown) => {
    throw new AiError(
      `无法连接接口：${error instanceof Error ? error.message : String(error)}`,
    );
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new AiError(`接口返回 ${response.status}：${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    data?: { id?: string; name?: string }[];
    models?: { id?: string; name?: string }[];
  };

  // 兼容 OpenAI 的 { data: [...] } 与部分网关的 { models: [...] }
  const rawItems: { id?: string; name?: string }[] = [
    ...(data.data ?? []),
    ...(data.models ?? []),
  ];

  const ids = rawItems
    .map((item) => item.id ?? item.name ?? "")
    .filter((id): id is string => Boolean(id))
    .sort((a, b) => a.localeCompare(b));

  if (ids.length === 0) throw new AiError("接口没有返回任何模型");
  return ids;
}

/* ---------------- 对话补全（含工具调用） ---------------- */

export type AiToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type AiChatMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAiToolCallPayload[];
    }
  | { role: "tool"; content: string; tool_call_id: string; name?: string };

export type OpenAiToolCallPayload = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type OpenAiTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type AiChatResult = {
  content: string;
  toolCalls: AiToolCall[];
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number } | null;
  raw: {
    role: "assistant";
    content: string | null;
    tool_calls?: OpenAiToolCallPayload[];
  };
};

/** 兼容旧签名的一层封装：system/user/assistant 三种角色的普通消息 */
export type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function chatCompletion(
  config: AiConfig,
  messages: AiChatMessage[],
  options: {
    model?: string;
    tools?: OpenAiTool[];
    toolChoice?: "auto" | "none";
    temperature?: number;
    maxTokens?: number;
  } = {},
): Promise<AiChatResult> {
  if (!config.baseUrl || !config.apiKey)
    throw new AiError("AI 未配置接口地址或密钥");
  const model = resolveModel(config, options.model);
  if (!model) throw new AiError("请先选择模型");

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? config.temperature,
    max_tokens: options.maxTokens ?? config.maxTokens,
    stream: false,
  };
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = options.toolChoice ?? "auto";
  }

  const send = async (payload: Record<string, unknown>): Promise<Response> =>
    fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90_000),
    }).catch((error: unknown) => {
      throw new AiError(
        `调用失败：${error instanceof Error ? error.message : String(error)}`,
      );
    });

  let response = await send(body);

  // 有些 OpenAI 兼容网关还不支持 tools，这里退一步重试一次普通对话
  if (!response.ok && body.tools) {
    const text = await response
      .clone()
      .text()
      .catch(() => "");
    if (
      response.status === 400 ||
      response.status === 404 ||
      response.status === 422
    ) {
      console.warn(
        `[ai] 接口不支持工具调用（${response.status}），已退化为普通对话：${text.slice(0, 120)}`,
      );
      const fallback = { ...body };
      delete fallback.tools;
      delete fallback.tool_choice;
      response = await send(fallback);
    }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new AiError(`模型返回 ${response.status}：${text.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    choices?: {
      message?: {
        role?: string;
        content?: string | null;
        tool_calls?: OpenAiToolCallPayload[];
      };
      finish_reason?: string;
    }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const choice = data.choices?.[0];
  const message = choice?.message;
  if (!message) throw new AiError("模型没有返回内容");

  const toolCalls: AiToolCall[] = (message.tool_calls ?? []).map((call) => ({
    id: call.id,
    name: call.function?.name ?? "",
    arguments: call.function?.arguments ?? "{}",
  }));

  return {
    content: (message.content ?? "").trim(),
    toolCalls,
    finishReason: choice?.finish_reason ?? null,
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
        }
      : null,
    raw: {
      role: "assistant",
      content: message.content ?? null,
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    },
  };
}

export async function chatComplete(
  config: AiConfig,
  messages: AiMessage[],
  model?: string,
): Promise<string> {
  if (!isAiReady(config)) throw new AiError("AI 未启用或配置不完整");
  const result = await chatCompletion(config, messages, { model });
  if (!result.content) throw new AiError("模型没有返回内容");
  return result.content;
}

/* ---------------- Embedding ---------------- */

export async function embedTexts(
  config: AiConfig,
  texts: string[],
  model?: string,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!config.baseUrl || !config.apiKey)
    throw new AiError("AI 未配置接口地址或密钥");

  const embeddingModel = (model || config.embeddingModel).trim();
  if (!embeddingModel) throw new AiError("请先填写向量模型");

  const response = await fetch(`${config.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: embeddingModel, input: texts }),
    signal: AbortSignal.timeout(60_000),
  }).catch((error: unknown) => {
    throw new AiError(
      `向量接口调用失败：${error instanceof Error ? error.message : String(error)}`,
    );
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new AiError(`向量接口返回 ${response.status}：${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    data?: { embedding?: number[]; index?: number }[];
  };

  const items = data.data ?? [];
  if (items.length === 0) throw new AiError("向量接口没有返回数据");

  return items
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((item) => item.embedding ?? []);
}

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
