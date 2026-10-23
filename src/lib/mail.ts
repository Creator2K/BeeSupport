import nodemailer, { type Transporter } from "nodemailer";

import { prisma } from "./db";
import { env } from "./env";

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
};

export const SMTP_SETTING_KEY = "smtp";

/**
 * SMTP 配置优先取后台「系统设置」里的值，其次取环境变量。
 * 这样运维可以先跑起来，再在后台里改。
 */
export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  let stored: Partial<SmtpConfig> | undefined;

  try {
    const setting = await prisma.setting.findUnique({
      where: { key: SMTP_SETTING_KEY },
    });
    stored = (setting?.value ?? undefined) as Partial<SmtpConfig> | undefined;
  } catch (error) {
    console.error("[mail] 读取 SMTP 设置失败:", error);
  }

  if (stored?.host) {
    return {
      host: stored.host,
      port: Number(stored.port ?? 465),
      secure: stored.secure ?? Number(stored.port ?? 465) === 465,
      user: stored.user || undefined,
      pass: stored.pass || undefined,
      from: stored.from || stored.user || "BeeSupport <noreply@localhost>",
    };
  }

  if (env.SMTP_HOST) {
    const port = env.SMTP_PORT ?? 465;
    return {
      host: env.SMTP_HOST,
      port,
      secure: env.SMTP_SECURE ?? port === 465,
      user: env.SMTP_USER || undefined,
      pass: env.SMTP_PASS || undefined,
      from: env.SMTP_FROM || env.SMTP_USER || "BeeSupport <noreply@localhost>",
    };
  }

  return null;
}

let cached: { key: string; transporter: Transporter } | null = null;

async function getTransporter(): Promise<{
  transporter: Transporter;
  config: SmtpConfig;
} | null> {
  const config = await getSmtpConfig();
  if (!config) return null;

  const key = `${config.host}:${config.port}:${config.secure}:${config.user ?? ""}:${config.pass ?? ""}`;
  if (cached?.key === key) {
    return { transporter: cached.transporter, config };
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  cached = { key, transporter };
  return { transporter, config };
}

export type SendMailInput = {
  messageId?: string;
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

export async function sendMail(
  input: SendMailInput,
): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const resolved = await getTransporter();
  if (!resolved) {
    return { ok: false, skipped: true, error: "未配置 SMTP，已跳过发信" };
  }

  try {
    await resolved.transporter.sendMail({
      from: resolved.config.from,
      to: Array.isArray(input.to) ? input.to.join(",") : input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      replyTo: input.replyTo,
      messageId: input.messageId,
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[mail] 发送失败:", message);
    return { ok: false, error: message };
  }
}

/** 后台「测试发信」用 */
export async function verifySmtp(): Promise<{ ok: boolean; error?: string }> {
  const resolved = await getTransporter();
  if (!resolved) return { ok: false, error: "未配置 SMTP" };
  try {
    await resolved.transporter.verify();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
