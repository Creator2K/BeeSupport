import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  AI_SETTING_KEY,
  AiError,
  getAiConfig,
  listAiModels,
  normalizeBaseUrl,
} from "@/lib/ai";
import { recordAudit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { testAiConnection } from "@/server/services/ai";
import { toActionResult, type ActionResult } from "./result";
import {
  aiSettingsSchema,
  toConfig,
  type AiSettingsInput,
} from "./ai-schemas";

/**
 * 密钥不下发给浏览器，表单留空表示沿用已保存的值。只在接口地址没变时沿用，
 * 否则已保存的密钥会被发给一个新填的地址。
 */
async function withStoredApiKey<T extends { baseUrl: string; apiKey: string }>(
  input: T,
): Promise<T> {
  if (input.apiKey.trim()) return input;
  const current = await getAiConfig();
  if (!current.apiKey) return input;
  if (normalizeBaseUrl(input.baseUrl) !== normalizeBaseUrl(current.baseUrl))
    throw new AiError("修改接口地址后需要重新填写 API Key");
  return { ...input, apiKey: current.apiKey };
}

export async function saveAiSettingsAction(
  input: AiSettingsInput,
): Promise<ActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    const data = await withStoredApiKey(aiSettingsSchema.parse(input));

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
    if (error instanceof AiError) return { ok: false, error: error.message };
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
    const models = await listAiModels(
      await withStoredApiKey({
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
      }),
    );
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
    const config = await withStoredApiKey(toConfig(input));

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
