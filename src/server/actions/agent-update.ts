import { revalidatePath } from "next/cache";

import { HttpError, requireAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { adminDb } from "@/lib/tenant-db";
import { revokeAgentConnections } from "@/lib/realtime/emit";
import { assertTenantQuota } from "@/server/services/tenants";
import { toActionResult, type ActionResult } from "./result";
import {
  updateSchema,
  type UpdateAgentInput,
} from "./agent-schemas";

export async function updateAgentAction(
  id: string,
  input: UpdateAgentInput,
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const prisma = await adminDb();
    const data = updateSchema.parse(input);
    let role: "ADMIN" | "MERCHANT_ADMIN" | "AGENT" =
      data.role === "ADMIN" && admin.role !== "ADMIN"
        ? "MERCHANT_ADMIN"
        : data.role;

    const target = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        role: true,
        active: true,
        tenantId: true,
      },
    });
    if (!target) throw new HttpError(404, "账号不存在");

    if (
      (target.role === "MERCHANT_ADMIN" || target.tenantId !== "legacy") &&
      data.role === "ADMIN"
    )
      role = "MERCHANT_ADMIN";
    // 不允许把自己降级或禁用，避免把自己锁在门外
    if (target.id === admin.id && (data.role !== "ADMIN" || !data.active)) {
      throw new HttpError(400, "不能修改自己的角色或禁用自己的账号");
    }

    if (target.role === "ADMIN" && data.role !== "ADMIN") {
      const adminCount = await prisma.user.count({
        where: { role: "ADMIN", active: true },
      });
      if (adminCount <= 1) throw new HttpError(400, "至少需要保留一个管理员");
    }

    const ids = [...new Set(data.siteIds)];
    if (
      (await prisma.site.count({
        where: { id: { in: ids }, tenantId: target.tenantId },
      })) !== ids.length
    )
      throw new HttpError(403, "授权站点不属于该商家");
    if (
      target.role === "MERCHANT_ADMIN" &&
      (role !== "MERCHANT_ADMIN" || !data.active) &&
      (await prisma.user.count({
        where: {
          tenantId: target.tenantId,
          role: "MERCHANT_ADMIN",
          active: true,
        },
      })) <= 1
    )
      throw new HttpError(400, "至少保留一名启用的商家管理员");
    await prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: target.tenantId },
        data: { updatedAt: new Date() },
      });
      const current = await tx.user.findUniqueOrThrow({ where: { id } });
      if (
        current.active &&
        ((current.role === "MERCHANT_ADMIN" &&
          (role !== "MERCHANT_ADMIN" || !data.active)) ||
          (current.role === "ADMIN" && (role !== "ADMIN" || !data.active)))
      ) {
        if (
          (await tx.user.count({
            where: {
              tenantId: current.tenantId,
              role: current.role,
              active: true,
            },
          })) <= 1
        )
          throw new HttpError(400, "至少保留一名启用的管理员");
      }
      if (!current.active && data.active && role !== "ADMIN")
        await assertTenantQuota(tx, target.tenantId, "agents");
      await tx.user.update({
        where: { id },
        data: {
          name: data.name,
          role,
          active: data.active,
          tokenVersion: { increment: 1 },
        },
      });
      await tx.siteAgent.deleteMany({ where: { userId: id } });
      if (role === "AGENT" && ids.length)
        await tx.siteAgent.createMany({
          data: ids.map((siteId) => ({ userId: id, siteId })),
          skipDuplicates: true,
        });
    });
    revokeAgentConnections(id);

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "agent.update",
      targetType: "User",
      targetId: id,
      meta: { role: data.role, active: data.active, siteIds: data.siteIds },
    });

    revalidatePath("/admin/agents");
    return { ok: true, message: "客服账号已更新" };
  } catch (error) {
    return toActionResult(error);
  }
}
