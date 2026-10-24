import { z } from "zod";

import {
  defaultAiConfig,
  type AiConfig,
} from "@/lib/ai";

export const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().trim().max(500),
  apiKey: z.string().max(500),
  model: z.string().trim().max(200),
  // 可在工作台切换的模型清单
  models: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  assistantName: z.string().trim().min(1, "请填写 AI 显示名称").max(40),
  systemPrompt: z.string().trim().min(1, "请填写系统提示词").max(4000),
  autoReply: z.enum(["off", "no_agent", "always"]),
  temperature: z.coerce.number().min(0).max(2),
  maxTokens: z.coerce.number().int().min(64).max(8000),
  topK: z.coerce.number().int().min(0).max(20),
  historyLimit: z.coerce.number().int().min(0).max(50),
  enableEmbeddings: z.boolean().default(false),
  embeddingModel: z.string().trim().max(200).default(""),
  enableTools: z.boolean().default(true),
  maxToolRounds: z.coerce.number().int().min(1).max(8).default(4),
});

export type AiSettingsInput = z.input<typeof aiSettingsSchema>;

export const knowledgeSchema = z.object({
  title: z.string().trim().min(1, "请填写标题").max(120),
  content: z.string().trim().min(1, "请填写内容").max(6000),
  keywords: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  siteId: z.string().optional().nullable(),
  enabled: z.boolean().default(true),
});

export type KnowledgeInput = z.input<typeof knowledgeSchema>;

export function toConfig(input: AiSettingsInput): AiConfig {
  const defaults = defaultAiConfig();
  const parsed = aiSettingsSchema.parse(input);
  return {
    ...defaults,
    ...parsed,
    baseUrl: parsed.baseUrl,
    apiKey: parsed.apiKey,
    embeddingModel: parsed.embeddingModel || defaults.embeddingModel,
  };
}
