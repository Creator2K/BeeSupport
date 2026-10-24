import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AiError, getAiConfig } from "@/lib/ai";
import { recordAudit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import {
  knowledgeIndexStats,
  rebuildKnowledgeIndex,
} from "@/server/services/knowledge";

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
