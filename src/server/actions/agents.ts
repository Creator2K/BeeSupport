"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { HttpError, hashPassword, requireAdmin, requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { adminDb, tenantDb } from "@/lib/tenant-db";
import { revokeAgentConnections } from "@/lib/realtime/emit";
import { assertTenantQuota } from "@/server/services/tenants";
import { emailSchema, passwordSchema } from "@/lib/validation";
import { toActionResult, type ActionResult } from "./result";

const createSchema = z.object({
  name: z.string().trim().min(1, "请填写姓名").max(40),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(["ADMIN", "AGENT"]).default("AGENT"),
  siteIds: z.array(z.string()).max(200).default([]),
  active: z.boolean().default(true),
});

const updateSchema = z.object({
  name: z.string().trim().min(1, "请填写姓名").max(40),
  role: z.enum(["ADMIN", "AGENT"]),
  siteIds: z.array(z.string()).max(200).default([]),
  active: z.boolean(),
});

export type CreateAgentInput = z.input<typeof createSchema>;
export type UpdateAgentInput = z.input<typeof updateSchema>;

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
export async function listTransferTargetsAction(): Promise<
  { id: string; name: string; email: string; status: string }[]
> {
  const user = await requireUser();
  const prisma = tenantDb(user);
  const targets = await prisma.user.findMany({
    where: {
      active: true,
      id: { not: user.id },
      OR:
        user.siteIds === null
          ? undefined
          : [
              { role: "MERCHANT_ADMIN" },
              { sites: { some: { siteId: { in: user.siteIds } } } },
            ],
    },
    select: { id: true, name: true, email: true, status: true },
    orderBy: { name: "asc" },
  });
  return targets;
}
