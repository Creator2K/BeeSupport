"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { HttpError, requireAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { adminDb } from "@/lib/tenant-db";
import { assertTenantQuota } from "@/server/services/tenants";
import { widgetSettingsSchema } from "@/lib/branding";
import { siteSlugSchema } from "@/lib/validation";
import { toActionResult, type ActionResult } from "./result";
import { getIo } from "@/lib/realtime/emit";
import { rooms } from "@/lib/realtime/rooms";
import { ADMIN_PATH } from "@/lib/app-paths";

const originSchema = z.string().trim().max(200);

const workHoursSchema = z
  .object({
    enabled: z.boolean().optional(),
    timezone: z
      .string()
      .trim()
      .max(64)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return !/^[+-]/.test(value);
        } catch {
          return false;
        }
      }, "工作时间时区无效")
      .optional(),
    days: z
      .record(
        z.string().regex(/^[0-6]$/),
        z
          .array(
            z
              .tuple([
                z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
                z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
              ])
              .refine(
                ([start, end]) => start !== end,
                "开始和结束时间不能相同",
              ),
          )
          .max(12),
      )
      .optional(),
  })
  .nullable()
  .optional();

const optionalEmail = z
  .string()
  .trim()
  .max(200)
  .optional()
  .nullable()
  .transform((value) => (value ? value : null))
  .refine(
    (value) => value === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    "通知邮箱格式不正确",
  );

const siteInputSchema = z.object({
  widgetSettings: widgetSettingsSchema.optional(),
  name: z.string().trim().min(1, "请填写站点名称").max(60),
  slug: siteSlugSchema,
  description: z.string().trim().max(200).optional().nullable(),
  primaryColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "主题色格式应为 #RRGGBB")
    .default("#18181b"),
  position: z.enum(["right", "left"]).default("right"),
  welcomeMessage: z.string().trim().min(1).max(500),
  offlineMessage: z.string().trim().min(1).max(500),
  requireEmail: z.boolean().default(true),
  autoAssign: z.boolean().default(true),
  imageReviewEnabled: z.boolean().optional(),
  notifyEmail: optionalEmail,
  allowedOrigins: z.array(originSchema).max(50).default([]),
  workHours: workHoursSchema,
  active: z.boolean().default(true),
});

export type SiteInput = z.input<typeof siteInputSchema>;

function generatePublicKey(): string {
  return `bs_${randomBytes(16).toString("hex")}`;
}

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

export async function deleteSiteAction(id: string): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const prisma = await adminDb();

    const site = await prisma.site.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!site) throw new HttpError(404, "站点不存在");

    await prisma.site.delete({ where: { id } });

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "site.delete",
      targetType: "Site",
      targetId: id,
      meta: { name: site.name },
    });

    revalidatePath("/admin/sites");
    revalidatePath("/admin");
    return { ok: true, message: "站点已删除" };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function regenerateSiteKeyAction(
  id: string,
): Promise<ActionResult & { publicKey?: string }> {
  try {
    const admin = await requireAdmin();
    const prisma = await adminDb();

    const site = await prisma.site.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!site) throw new HttpError(404, "站点不存在");

    const publicKey = generatePublicKey();
    await prisma.site.update({ where: { id }, data: { publicKey } });

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "site.regenerate_key",
      targetType: "Site",
      targetId: id,
      meta: { name: site.name },
    });

    revalidatePath("/admin/sites");
    return { ok: true, message: "接入密钥已重置", publicKey };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function toggleSiteActiveAction(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const prisma = await adminDb();
    await prisma.site.update({ where: { id }, data: { active } });

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: active ? "site.enable" : "site.disable",
      targetType: "Site",
      targetId: id,
    });

    revalidatePath("/admin/sites");
    return { ok: true };
  } catch (error) {
    return toActionResult(error);
  }
}
