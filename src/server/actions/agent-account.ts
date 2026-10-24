import { revalidatePath } from "next/cache";

import { HttpError, hashPassword, requireAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { adminDb } from "@/lib/tenant-db";
import { revokeAgentConnections } from "@/lib/realtime/emit";
import { passwordSchema } from "@/lib/validation";
import { toActionResult, type ActionResult } from "./result";

export async function resetAgentPasswordAction(
  id: string,
  newPassword: string,
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const prisma = await adminDb();
    const password = passwordSchema.parse(newPassword);

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true },
    });
    if (!target) throw new HttpError(404, "账号不存在");

    const passwordHash = await hashPassword(password);
    await prisma.user.update({
      where: { id },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 },
        emailVerificationRequired: false,
      },
    });
    revokeAgentConnections(id);

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "agent.password.reset",
      targetType: "User",
      targetId: id,
      meta: { email: target.email },
    });

    revalidatePath("/admin/agents");
    return { ok: true, message: "密码已重置，账号可使用新密码登录" };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function deleteAgentAction(id: string): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const prisma = await adminDb();
    if (id === admin.id) throw new HttpError(400, "不能删除当前登录的账号");

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, tenantId: true },
    });
    if (!target) throw new HttpError(404, "账号不存在");

    if (target.role === "ADMIN") {
      const adminCount = await prisma.user.count({
        where: { role: "ADMIN", active: true },
      });
      if (adminCount <= 1) throw new HttpError(400, "至少需要保留一个管理员");
    }

    if (
      target.role === "MERCHANT_ADMIN" &&
      (await prisma.user.count({
        where: {
          tenantId: target.tenantId,
          role: "MERCHANT_ADMIN",
          active: true,
        },
      })) <= 1
    )
      throw new HttpError(400, "至少保留一名商家管理员");
    await prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: target.tenantId },
        data: { updatedAt: new Date() },
      });
      const current = await tx.user.findUniqueOrThrow({ where: { id } });
      if (
        current.active &&
        current.role !== "AGENT" &&
        (await tx.user.count({
          where: {
            tenantId: current.tenantId,
            role: current.role,
            active: true,
          },
        })) <= 1
      )
        throw new HttpError(400, "至少保留一名启用的管理员");
      await tx.user.delete({ where: { id } });
    });
    revokeAgentConnections(id);

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "agent.delete",
      targetType: "User",
      targetId: id,
      meta: { email: target.email },
    });

    revalidatePath("/admin/agents");
    return { ok: true, message: "客服账号已删除" };
  } catch (error) {
    return toActionResult(error);
  }
}

/** 客服工作台用：可转交的同站点同事 */
