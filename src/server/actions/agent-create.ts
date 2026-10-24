import { revalidatePath } from "next/cache";

import { HttpError, hashPassword, requireAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { adminDb } from "@/lib/tenant-db";
import { assertTenantQuota } from "@/server/services/tenants";
import { toActionResult, type ActionResult } from "./result";
import {
  createSchema,
  type CreateAgentInput,
} from "./agent-schemas";

export async function createAgentAction(
  input: CreateAgentInput,
): Promise<ActionResult & { agentId?: string }> {
  try {
    const admin = await requireAdmin();
    const prisma = await adminDb();
    const data = createSchema.parse(input);
    const role =
      data.role === "ADMIN" && admin.role !== "ADMIN"
        ? "MERCHANT_ADMIN"
        : data.role;
    const ids = [...new Set(data.siteIds)];
    if (
      (await prisma.site.count({
        where: { id: { in: ids }, tenantId: admin.tenantId },
      })) !== ids.length
    )
      throw new HttpError(403, "授权站点不属于当前商家");

    const existing = await prisma.user.findUnique({
      where: { email: data.email },
      select: { id: true },
    });
    if (existing) throw new HttpError(400, "该邮箱已被使用");

    const passwordHash = await hashPassword(data.password);
    const agent = await prisma.$transaction(async (tx) => {
      if (data.active && role !== "ADMIN")
        await assertTenantQuota(tx, admin.tenantId, "agents");
      return tx.user.create({
        data: {
          name: data.name,
          email: data.email,
          passwordHash,
          tenantId: admin.tenantId,
          role,
          active: data.active,
          sites:
            data.role === "ADMIN" || data.siteIds.length === 0
              ? undefined
              : {
                  create: data.siteIds.map((siteId) => ({ siteId })),
                },
        },
        select: { id: true, name: true, email: true },
      });
    });

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "agent.create",
      targetType: "User",
      targetId: agent.id,
      meta: { email: agent.email, role: data.role },
    });

    revalidatePath("/admin/agents");
    return { ok: true, message: "客服账号已创建", agentId: agent.id };
  } catch (error) {
    return toActionResult(error);
  }
}
