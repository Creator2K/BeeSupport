import { revalidatePath } from "next/cache";

import { invalidateKnowledgeCache } from "@/lib/ai";
import { recordAudit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resourceTenantId } from "@/server/services/tenants";
import { enqueueKnowledgeIndex } from "@/server/services/ai-job-queue";
import { toActionResult, type ActionResult } from "./result";
import {
  knowledgeSchema,
  type KnowledgeInput,
} from "./ai-schemas";

export async function createKnowledgeAction(
  input: KnowledgeInput,
): Promise<ActionResult & { id?: string }> {
  try {
    const admin = await requirePlatformAdmin();
    const data = knowledgeSchema.parse(input);
    const tenantId = await resourceTenantId(admin, data.siteId);

    const created = await prisma.$transaction(async (tx) => {
      const created = await tx.aiKnowledge.create({
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
      await enqueueKnowledgeIndex(tx, tenantId, created.id);
      return created;
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

    await prisma.$transaction(async (tx) => {
      await tx.aiKnowledge.update({
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
      // Do not serve stale chunks while the replacement index is pending.
      await tx.aiKnowledgeChunk.deleteMany({ where: { knowledgeId: id } });
      await enqueueKnowledgeIndex(tx, tenantId, id);
    });

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "ai.knowledge.update",
      targetType: "AiKnowledge",
      targetId: id,
    });

    invalidateKnowledgeCache();

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
