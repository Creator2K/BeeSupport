"use server";

import { invalidateKnowledgeCache } from "@/lib/ai";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  AI_SETTING_KEY,
  AiError,
  defaultAiConfig,
  getAiConfig,
  listAiModels,
  type AiConfig,
} from "@/lib/ai";
import { requirePlatformAdmin } from "@/lib/auth";
import { resourceTenantId } from "@/server/services/tenants";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { testAiConnection } from "@/server/services/ai";
import {
  knowledgeIndexStats,
  rebuildKnowledgeIndex,
  scheduleKnowledgeIndexRebuild,
} from "@/server/services/knowledge";
import { toActionResult, type ActionResult } from "./result";

const aiSettingsSchema = z.object({
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

const knowledgeSchema = z.object({
  title: z.string().trim().min(1, "请填写标题").max(120),
  content: z.string().trim().min(1, "请填写内容").max(6000),
  keywords: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  siteId: z.string().optional().nullable(),
  enabled: z.boolean().default(true),
});

export type KnowledgeInput = z.input<typeof knowledgeSchema>;

function toConfig(input: AiSettingsInput): AiConfig {
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

export async function saveAiSettingsAction(
  input: AiSettingsInput,
): Promise<ActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    const data = aiSettingsSchema.parse(input);

    // 默认模型必须在清单里，否则工作台模型切换会指向一个不存在的模型
    const models = Array.from(
      new Set([data.model, ...data.models].filter(Boolean)),
    );

    await prisma.setting.upsert({
      where: { key: AI_SETTING_KEY },
      create: { key: AI_SETTING_KEY, value: { ...data, models } },
      update: { value: { ...data, models } },
    });

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "settings.ai.update",
      targetType: "Setting",
      targetId: AI_SETTING_KEY,
      meta: {
        enabled: data.enabled,
        model: data.model,
        models,
        autoReply: data.autoReply,
        tools: data.enableTools,
        embeddings: data.enableEmbeddings,
      },
    });

    revalidatePath("/admin", "layout");
    return { ok: true, message: "AI 配置已保存" };
  } catch (error) {
    return toActionResult(error);
  }
}

/** 拉取模型列表（用当前表单里的地址与密钥，未保存也能测） */
export async function listAiModelsAction(input: {
  baseUrl: string;
  apiKey: string;
}): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  try {
    await requirePlatformAdmin();
    const models = await listAiModels({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
    });
    return { ok: true, models };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof AiError ? error.message : "获取模型失败",
    };
  }
}

export async function testAiAction(
  input: AiSettingsInput & { prompt: string },
): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    const admin = await requirePlatformAdmin();
    const prompt = z.string().trim().min(1).max(500).parse(input.prompt);
    const config = toConfig(input);

    const result = await testAiConnection({ config, prompt });
    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "settings.ai.test",
      meta: { model: result.model, ok: true },
    });

    return { ok: true, text: result.text };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof AiError ? error.message : "AI 接口不可用",
    };
  }
}

export async function createKnowledgeAction(
  input: KnowledgeInput,
): Promise<ActionResult & { id?: string }> {
  try {
    const admin = await requirePlatformAdmin();
    const data = knowledgeSchema.parse(input);
    const tenantId = await resourceTenantId(admin, data.siteId);

    const created = await prisma.aiKnowledge.create({
      data: {
        tenantId,
        title: data.title,
        content: data.content,
        keywords: data.keywords,
        siteId: data.siteId || null,
        enabled: data.enabled,
      },
      select: { id: true },
    });

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "ai.knowledge.create",
      targetType: "AiKnowledge",
      targetId: created.id,
      meta: { title: data.title },
    });

    invalidateKnowledgeCache();
    scheduleKnowledgeIndexRebuild(created.id);

    revalidatePath("/admin", "layout");
    return { ok: true, message: "条目已创建", id: created.id };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function updateKnowledgeAction(
  id: string,
  input: KnowledgeInput,
): Promise<ActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    const data = knowledgeSchema.parse(input);

    const existing = await prisma.aiKnowledge.findUnique({
      where: { id },
      select: { id: true, tenantId: true },
    });
    if (!existing) return { ok: false, error: "条目不存在" };
    const tenantId = await resourceTenantId(
      admin,
      data.siteId,
      existing.tenantId,
    );

    await prisma.aiKnowledge.update({
      where: { id },
      data: {
        tenantId,
        title: data.title,
        content: data.content,
        keywords: data.keywords,
        siteId: data.siteId || null,
        enabled: data.enabled,
      },
    });

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "ai.knowledge.update",
      targetType: "AiKnowledge",
      targetId: id,
    });

    invalidateKnowledgeCache();
    scheduleKnowledgeIndexRebuild(id);

    revalidatePath("/admin", "layout");
    return { ok: true, message: "条目已更新" };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function deleteKnowledgeAction(id: string): Promise<ActionResult> {
  try {
    const admin = await requirePlatformAdmin();

    const existing = await prisma.aiKnowledge.findUnique({
      where: { id },
      select: { id: true, title: true },
    });
    if (!existing) return { ok: false, error: "条目不存在" };

    invalidateKnowledgeCache();
    await prisma.aiKnowledge.delete({ where: { id } });

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "ai.knowledge.delete",
      targetType: "AiKnowledge",
      targetId: id,
      meta: { title: existing.title },
    });

    revalidatePath("/admin", "layout");
    return { ok: true, message: "条目已删除" };
  } catch (error) {
    return toActionResult(error);
  }
}

/** 重建知识库切片索引（可选向量化），后台按钮触发 */
export async function rebuildKnowledgeIndexAction(input?: {
  knowledgeId?: string;
  useEmbeddings?: boolean;
}): Promise<{
  ok: boolean;
  result?: {
    entries: number;
    chunks: number;
    embedded: number;
    vectorized: boolean;
    durationMs: number;
  };
  stats?: { entries: number; chunks: number; vectorized: number };
  error?: string;
}> {
  try {
    const admin = await requirePlatformAdmin();
    const parsed = z
      .object({
        knowledgeId: z.string().optional(),
        useEmbeddings: z.boolean().optional(),
      })
      .parse(input ?? {});

    const config = await getAiConfig();
    const result = await rebuildKnowledgeIndex({
      knowledgeId: parsed.knowledgeId,
      config:
        parsed.useEmbeddings === undefined
          ? config
          : { ...config, enableEmbeddings: parsed.useEmbeddings },
    });

    const stats = await knowledgeIndexStats();

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "ai.knowledge.reindex",
      targetType: "AiKnowledge",
      targetId: parsed.knowledgeId ?? "all",
      meta: {
        chunks: result.chunks,
        embedded: result.embedded,
        vectorized: result.vectorized,
      },
    });

    revalidatePath("/admin", "layout");
    return { ok: true, result, stats };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof AiError ? error.message : "重建索引失败",
    };
  }
}

/** 索引概况 */
export async function knowledgeIndexStatsAction(): Promise<{
  entries: number;
  chunks: number;
  vectorized: number;
}> {
  await requirePlatformAdmin();
  return knowledgeIndexStats();
}
