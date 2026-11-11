"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { HttpError, requireAdmin } from "@/lib/auth";
import { resourceTenantId } from "@/server/services/tenants";
import { recordAudit } from "@/lib/audit";
import { adminDb } from "@/lib/tenant-db";
import { publicWebhookTarget } from "@/lib/public-webhook";
import { testWebhook } from "@/lib/webhooks";
import { toActionResult, type ActionResult } from "./result";

const WEBHOOK_TYPES = [
  "GENERIC",
  "TELEGRAM",
  "DINGTALK",
  "WECHAT_WORK",
  "WECHAT",
  "WECHAT_BOT",
] as const;

const webhookInputSchema = z
  .object({
    name: z.string().trim().min(1, "请填写渠道名称").max(60),
    type: z.enum(WEBHOOK_TYPES),
    // WECHAT_BOT 填的是微信接收人（wxid / 备注名，留空表示用默认接收人），其余类型必须是 URL
    url: z.string().trim().max(1000),
    secret: z.string().trim().max(200).optional().nullable(),
    clearSecret: z.boolean().optional(),
    events: z.array(z.string().max(60)).max(20).default([]),
    siteId: z.string().optional().nullable(),
    active: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    if (data.type === "WECHAT_BOT") {
      if (data.url && /[\s/]/.test(data.url)) {
        ctx.addIssue({
          code: "custom",
          path: ["url"],
          message: "微信接收人不能包含空格或斜杠",
        });
      }
      return;
    }
    if (!data.url) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "请填写推送地址",
      });
      return;
    }
    try {
      const parsed = new URL(data.url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("bad protocol");
      }
    } catch {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "请填写合法的推送地址",
      });
    }
  });

export type WebhookInput = z.input<typeof webhookInputSchema>;

/**
 * 密钥不下发给浏览器，编辑时留空表示沿用已保存的值。只在渠道类型不变时沿用；
 * WECHAT 的密钥会作为 Bearer 发给推送地址，地址变了必须重新填写。
 */
function keptSecret(
  stored: { type: string; url: string; secret: string | null },
  next: { type: string; url: string },
): string | null {
  if (!stored.secret || stored.type !== next.type) return null;
  if (next.type === "WECHAT" && stored.url !== next.url)
    throw new HttpError(400, "修改推送地址后需要重新填写密钥");
  return stored.secret;
}

export async function createWebhookAction(
  input: WebhookInput,
): Promise<ActionResult & { id?: string }> {
  try {
    const admin = await requireAdmin();
    const prisma = await adminDb();
    const data = webhookInputSchema.parse(input);
    if (
      admin.role !== "ADMIN" &&
      (data.type === "WECHAT_BOT" || data.type === "WECHAT")
    )
      throw new HttpError(403, "个人微信机器人由平台统一管理");
    if (admin.role !== "ADMIN") await publicWebhookTarget(data.url);

    const tenantId = await resourceTenantId(admin, data.siteId);
    const created = await prisma.webhookEndpoint.create({
      data: {
        tenantId,
        name: data.name,
        type: data.type,
        url: data.url,
        secret: data.secret || null,
        events: data.events,
        siteId: data.siteId || null,
        active: data.active,
      },
      select: { id: true },
    });

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "webhook.create",
      targetType: "WebhookEndpoint",
      targetId: created.id,
      meta: { name: data.name, type: data.type },
    });

    revalidatePath("/admin/webhooks");
    return { ok: true, message: "渠道已创建", id: created.id };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function updateWebhookAction(
  id: string,
  input: WebhookInput,
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const prisma = await adminDb();
    const data = webhookInputSchema.parse(input);
    if (
      admin.role !== "ADMIN" &&
      (data.type === "WECHAT_BOT" || data.type === "WECHAT")
    )
      throw new HttpError(403, "个人微信机器人由平台统一管理");
    if (admin.role !== "ADMIN") await publicWebhookTarget(data.url);

    const existing = await prisma.webhookEndpoint.findUnique({
      where: { id },
      select: {
        id: true,
        tenantId: true,
        type: true,
        url: true,
        secret: true,
      },
    });
    if (!existing) throw new HttpError(404, "渠道不存在");
    const tenantId = await resourceTenantId(
      admin,
      data.siteId,
      existing.tenantId,
    );
    const secret =
      data.secret || (data.clearSecret ? null : keptSecret(existing, data));

    await prisma.webhookEndpoint.update({
      where: { id },
      data: {
        tenantId,
        name: data.name,
        type: data.type,
        url: data.url,
        secret,
        events: data.events,
        siteId: data.siteId || null,
        active: data.active,
      },
    });

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "webhook.update",
      targetType: "WebhookEndpoint",
      targetId: id,
    });

    revalidatePath("/admin/webhooks");
    return { ok: true, message: "渠道已更新" };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function deleteWebhookAction(id: string): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const prisma = await adminDb();

    const existing = await prisma.webhookEndpoint.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!existing) throw new HttpError(404, "渠道不存在");

    await prisma.webhookEndpoint.delete({ where: { id } });

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "webhook.delete",
      targetType: "WebhookEndpoint",
      targetId: id,
      meta: { name: existing.name },
    });

    revalidatePath("/admin/webhooks");
    return { ok: true, message: "渠道已删除" };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function toggleWebhookAction(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  try {
    const prisma = await adminDb();
    await prisma.webhookEndpoint.update({ where: { id }, data: { active } });
    revalidatePath("/admin/webhooks");
    return { ok: true };
  } catch (error) {
    return toActionResult(error);
  }
}

/** 发送一条测试消息，验证渠道配置是否正确 */
export async function testWebhookAction(input: {
  id?: string;
  type: (typeof WEBHOOK_TYPES)[number];
  url: string;
  secret?: string | null;
  siteId?: string | null;
}): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const prisma = await adminDb();
    const parsed = z
      .object({
        id: z.string().max(64).optional(),
        type: z.enum(WEBHOOK_TYPES),
        url: z.string().trim().min(1, "请填写推送地址").max(1000),
        secret: z.string().trim().max(200).optional().nullable(),
        siteId: z.string().optional().nullable(),
      })
      .parse(input);

    if (
      admin.role !== "ADMIN" &&
      (parsed.type === "WECHAT_BOT" || parsed.type === "WECHAT")
    )
      throw new HttpError(403, "个人微信机器人由平台统一管理");
    if (admin.role !== "ADMIN") await publicWebhookTarget(parsed.url);
    if (parsed.type !== "WECHAT_BOT") {
      // 其他渠道仍然要求合法 URL，避免把明显的错填当真发出去
      try {
        const target = new URL(parsed.url);
        if (target.protocol !== "http:" && target.protocol !== "https:") {
          throw new Error("bad protocol");
        }
      } catch {
        throw new HttpError(400, "请填写合法的推送地址");
      }
    }

    const site = parsed.siteId
      ? await prisma.site.findUnique({
          where: { id: parsed.siteId },
          select: { id: true, name: true },
        })
      : await prisma.site.findFirst({ select: { id: true, name: true } });

    if (!site) throw new HttpError(400, "请先创建至少一个站点");

    let secret = parsed.secret || null;
    if (!secret && parsed.id) {
      const stored = await prisma.webhookEndpoint.findUnique({
        where: { id: parsed.id },
        select: { type: true, url: true, secret: true },
      });
      // 已保存的密钥只用于它所属的渠道类型和地址
      if (stored && stored.type === parsed.type && stored.url === parsed.url)
        secret = stored.secret;
    }

    const result = await testWebhook(
      parsed.type,
      parsed.url,
      secret,
      site.id,
      site.name,
      admin.role !== "ADMIN",
    );

    return result.ok
      ? { ok: true, message: "测试消息已发送" }
      : { ok: false, error: `发送失败：${result.error ?? "未知错误"}` };
  } catch (error) {
    return toActionResult(error);
  }
}
