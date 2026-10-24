import { revalidatePath } from "next/cache";

import { HttpError, requireAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { adminDb } from "@/lib/tenant-db";
import { assertTenantQuota } from "@/server/services/tenants";
import { ADMIN_PATH } from "@/lib/app-paths";
import { getIo } from "@/lib/realtime/emit";
import { rooms } from "@/lib/realtime/rooms";
import { toActionResult, type ActionResult } from "./result";
import {
  generatePublicKey,
  siteInputSchema,
  type SiteInput,
} from "./site-schemas";

export async function createSiteAction(
  input: SiteInput,
): Promise<ActionResult & { siteId?: string }> {
  try {
    const admin = await requireAdmin();
    const prisma = await adminDb();
    const data = siteInputSchema.parse(input);

    const existing = await prisma.site.findUnique({
      where: { slug: data.slug },
      select: { id: true },
    });
    if (existing) throw new HttpError(400, "该站点标识已被使用");

    const site = await prisma.$transaction(async (tx) => {
      await assertTenantQuota(tx, admin.tenantId, "sites");
      return tx.site.create({
        data: {
          ...data,
          tenantId: admin.tenantId,
          publicKey: generatePublicKey(),
          description: data.description ?? null,
          workHours: data.workHours ?? undefined,
        },
        select: { id: true, name: true },
      });
    });

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "site.create",
      targetType: "Site",
      targetId: site.id,
      meta: { name: site.name },
    });

    revalidatePath("/admin/sites");
    revalidatePath("/admin");
    return { ok: true, message: "站点已创建", siteId: site.id };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function updateSiteAction(
  id: string,
  input: SiteInput,
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const prisma = await adminDb();
    const data = siteInputSchema.parse(input);

    const site = await prisma.site.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true, tenantId: true },
    });
    if (!site) throw new HttpError(404, "站点不存在");

    if (data.slug !== site.slug) {
      const clash = await prisma.site.findUnique({
        where: { slug: data.slug },
        select: { id: true },
      });
      if (clash && clash.id !== id)
        throw new HttpError(400, "该站点标识已被使用");
    }

    const released = await prisma.$transaction(async (tx) => {
      await tx.site.update({
        where: { id },
        data: {
          ...data,
          widgetSettings: data.widgetSettings ?? undefined,
          description: data.description ?? null,
          workHours: data.workHours ?? undefined,
        },
      });
      if (data.imageReviewEnabled === false) {
        const held = await tx.visitor.findMany({
          where: { siteId: id, pendingImageId: { not: null } },
          select: { id: true, pendingImageId: true },
        });
        await tx.visitor.updateMany({
          where: { siteId: id, pendingImageId: { not: null } },
          data: { pendingImageId: null },
        });
        await tx.attachment.updateMany({
          where: { siteId: id, imageReviewState: "PENDING" },
          data: { imageReviewState: "RELEASED" },
        });
        return held;
      }
      return [];
    });
    for (const visitor of released) {
      getIo()
        ?.to(rooms.visitor(visitor.id))
        .emit("image:gate", { enabled: false, pending: null });
      getIo()
        ?.to([
          rooms.siteAgents(id),
          rooms.tenantAdmins(site.tenantId),
          rooms.admins(),
        ])
        .emit("image:reviewed", {
          attachmentId: visitor.pendingImageId,
          state: "RELEASED",
        });
    }

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "site.update",
      targetType: "Site",
      targetId: id,
      meta: { name: data.name },
    });

    revalidatePath("/admin/sites");
    revalidatePath(`${ADMIN_PATH}/sites`);
    return { ok: true, message: "站点已更新" };
  } catch (error) {
    return toActionResult(error);
  }
}
