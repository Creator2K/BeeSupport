"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin, HttpError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ADMIN_PATH } from "@/lib/app-paths";
import {
  REMINDER_SETTING_KEY,
  readReminderSettings,
  reminderSettingsSchema,
} from "@/lib/subscription-reminders";
import { toActionResult } from "./result";
export async function saveReminderSettingsAction(
  input: unknown,
  revision: string,
) {
  try {
    const user = await requirePlatformAdmin(),
      settings = reminderSettingsSchema.parse(input);
    const next = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('beesupport:subscription-reminders'))`;
      const current = await tx.setting.findUnique({
        where: { key: REMINDER_SETTING_KEY },
      });
      if (readReminderSettings(current?.value).revision !== revision)
        throw new HttpError(409, "提醒配置已更新，请刷新后重试");
      const document = { revision: randomUUID(), settings };
      await tx.setting.upsert({
        where: { key: REMINDER_SETTING_KEY },
        create: { key: REMINDER_SETTING_KEY, value: document },
        update: { value: document },
      });
      await tx.auditLog.create({
        data: {
          tenantId: user.tenantId,
          actorId: user.id,
          actorName: user.name,
          action: "subscription.reminders.settings",
          targetType: "Setting",
          targetId: REMINDER_SETTING_KEY,
          meta: settings,
        },
      });
      return document.revision;
    });
    revalidatePath(`${ADMIN_PATH}/reminders`);
    return { ok: true as const, message: "到期提醒配置已保存", revision: next };
  } catch (error) {
    return toActionResult(error);
  }
}
