"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { HttpError, requirePlatformAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { SMTP_SETTING_KEY, sendMail, verifySmtp } from "@/lib/mail";
import { toActionResult, type ActionResult } from "./result";

const smtpSchema = z.object({
  host: z.string().trim().min(1, "请填写 SMTP 服务器").max(200),
  port: z.coerce.number().int().min(1).max(65535).default(465),
  secure: z.boolean().default(true),
  user: z.string().trim().max(200).optional().default(""),
  pass: z.string().max(200).optional().default(""),
  from: z.string().trim().max(200).optional().default(""),
});

export type SmtpInput = z.input<typeof smtpSchema>;
type SmtpData = z.output<typeof smtpSchema>;

/**
 * 密码不下发给浏览器，表单留空表示沿用已保存的值。只在服务器和账号都没变时沿用，
 * 否则已保存的密码会被发给一台新填的服务器。
 */
async function withStoredSmtpPassword(data: SmtpData): Promise<SmtpData> {
  if (data.pass || !data.user) return data;
  const setting = await prisma.setting.findUnique({
    where: { key: SMTP_SETTING_KEY },
  });
  const stored = (setting?.value ?? null) as Partial<SmtpData> | null;
  if (!stored?.pass) return data;
  if (stored.host !== data.host || stored.user !== data.user)
    throw new HttpError(400, "修改 SMTP 服务器或账号后需要重新填写密码");
  return { ...data, pass: stored.pass };
}

export async function saveSmtpAction(input: SmtpInput): Promise<ActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    const data = await withStoredSmtpPassword(smtpSchema.parse(input));

    await prisma.setting.upsert({
      where: { key: SMTP_SETTING_KEY },
      create: { key: SMTP_SETTING_KEY, value: data },
      update: { value: data },
    });

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "settings.smtp.update",
      targetType: "Setting",
      targetId: SMTP_SETTING_KEY,
      meta: { host: data.host, port: data.port },
    });

    revalidatePath("/admin/settings");
    return { ok: true, message: "SMTP 配置已保存" };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function testSmtpAction(input?: SmtpInput): Promise<ActionResult> {
  try {
    const admin = await requirePlatformAdmin();

    // 传了参数就先落库再测试，方便「保存并测试」一个按钮搞定
    if (input) {
      const data = await withStoredSmtpPassword(smtpSchema.parse(input));
      await prisma.setting.upsert({
        where: { key: SMTP_SETTING_KEY },
        create: { key: SMTP_SETTING_KEY, value: data },
        update: { value: data },
      });
    }

    const result = await verifySmtp();
    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "settings.smtp.test",
      meta: { ok: result.ok },
    });

    return result.ok
      ? { ok: true, message: "SMTP 连接正常" }
      : { ok: false, error: `连接失败：${result.error ?? "未知错误"}` };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function sendTestMailAction(to: string): Promise<ActionResult> {
  try {
    await requirePlatformAdmin();
    const email = z.string().trim().email("请填写合法邮箱").parse(to);

    const result = await sendMail({
      to: email,
      subject: "BeeSupport 测试邮件",
      text: "这是一封来自 BeeSupport 的测试邮件，收到即代表 SMTP 配置正确。",
      html: "<p>这是一封来自 <strong>BeeSupport</strong> 的测试邮件，收到即代表 SMTP 配置正确。</p>",
    });

    if (result.skipped) return { ok: false, error: "尚未配置 SMTP" };
    return result.ok
      ? { ok: true, message: "测试邮件已发送" }
      : { ok: false, error: `发送失败：${result.error ?? "未知错误"}` };
  } catch (error) {
    return toActionResult(error);
  }
}
