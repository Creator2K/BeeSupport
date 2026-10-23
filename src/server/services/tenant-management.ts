import { prisma } from "../../lib/db";
import { HttpError, type SessionUser } from "../../lib/auth";
import { tenantManagementSchema } from "../../lib/tenant-management";
export async function saveManagedTenant(
  user: SessionUser,
  input: unknown,
  id?: string,
  owner?: { name: string; email: string; passwordHash: string },
  expectedVersion?: number,
) {
  if (user.role !== "ADMIN") throw new HttpError(403, "仅平台管理员可管理商家");
  const data = tenantManagementSchema.parse(input);
  if (id && (!Number.isInteger(expectedVersion) || expectedVersion! < 0))
    throw new HttpError(400, "缺少商家版本，请刷新列表后重试");
  if (!id && !owner) throw new HttpError(400, "请填写商家管理员账号");
  return prisma.$transaction(async (tx) => {
    const values = {
      ...data,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      contactEmail: data.contactEmail || null,
      note: data.note || null,
    };
    let tenant;
    if (id) {
      const result = await tx.tenant.updateMany({
        where: { id, managementVersion: expectedVersion },
        data: { ...values, managementVersion: { increment: 1 } },
      });
      if (!result.count)
        throw new HttpError(
          409,
          "商家设置或续费结果已更新，请刷新列表后重新编辑",
        );
      if (data.status !== "ACTIVE")
        await tx.user.updateMany({
          where: { tenantId: id, role: { not: "ADMIN" } },
          data: { tokenVersion: { increment: 1 } },
        });
      tenant = await tx.tenant.findUniqueOrThrow({ where: { id } });
    } else
      tenant = await tx.tenant.create({
        data: {
          ...values,
          users: { create: { ...owner!, role: "MERCHANT_ADMIN" } },
        },
      });
    await tx.auditLog.create({
      data: {
        tenantId: user.tenantId,
        actorId: user.id,
        actorName: user.name,
        action: id ? "tenant.update" : "tenant.create",
        targetType: "Tenant",
        targetId: tenant.id,
        meta: {
          name: tenant.name,
          status: tenant.status,
          planName: tenant.planName,
          features: data.features,
        },
      },
    });
    return tenant;
  });
}
