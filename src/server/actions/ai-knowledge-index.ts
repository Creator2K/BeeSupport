import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AiError } from "@/lib/ai";
import { recordAudit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import {
  knowledgeIndexStats,
  requestKnowledgeIndex,
} from "@/server/services/knowledge";

export async function rebuildKnowledgeIndexAction(input?: {
  knowledgeId?: string;
  useEmbeddings?: boolean;
}): Promise<{
  ok: boolean;
  result?: { queued: number };
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

    const result = await requestKnowledgeIndex({
      knowledgeId: parsed.knowledgeId,
      useEmbeddings: parsed.useEmbeddings,
    });

    const stats = await knowledgeIndexStats();

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "ai.knowledge.reindex",
      targetType: "AiKnowledge",
      targetId: parsed.knowledgeId ?? "all",
      meta: {
        queued: result.queued,
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
