import { prisma } from "./db";
import { logger } from "./logger";

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

export function normalizeBaseUrl(value: string): string {
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
    logger.error("ai.config_load_failed", {}, error);
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
