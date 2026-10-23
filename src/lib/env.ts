import "dotenv/config";
import { z } from "zod";

/**
 * 环境变量集中校验。任何一处缺失都会在启动阶段直接失败，
 * 避免把配置问题拖到运行期才暴露。
 */
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  DATABASE_URL: z.string().min(1, "缺少 DATABASE_URL"),

  // 可选：不配置时实时通道退化为单实例模式
  REDIS_URL: z.string().optional(),

  AUTH_SECRET: z
    .string()
    .min(16, "AUTH_SECRET 至少 16 个字符，建议 openssl rand -base64 48 生成"),

  APP_URL: z.string().default("http://localhost:3000"),
  PORT: z.coerce.number().int().positive().default(3000),
  REPORT_TIMEZONE: z
    .string()
    .max(64)
    .default("Asia/Shanghai")
    .refine((value) => {
      if (/^[+-]/.test(value)) return false;
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "REPORT_TIMEZONE 必须是有效的 IANA 时区，例如 Asia/Shanghai 或 UTC")
    .transform(
      (value) =>
        new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions()
          .timeZone,
    ),

  UPLOAD_DIR: z.string().default("./data/uploads"),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(20 * 1024 * 1024),

  // 个人微信通知（进程内扫码登录），凭证目录默认落在 UPLOAD_DIR 下
  WECHATBOT_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  WECHATBOT_STORAGE_DIR: z.string().optional(),
  WECHATBOT_DEFAULT_TO: z.string().optional(),

  // 邮件通知（后台「系统设置」中的配置优先级更高）
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
});

// 空字符串统一视为「未设置」：docker compose 会用 ${VAR:-} 传空串，
// 直接进 coerce 会被当成 0 / false 之类的有效值，反而引发误判。
const normalizedEnv = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => [
    key,
    value === "" ? undefined : value,
  ]),
);

const parsed = schema.safeParse(normalizedEnv);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(
    `环境变量校验失败：\n${details}\n请参考 .env.example 配置 .env`,
  );
}

export const env = parsed.data;

export const isProd = env.NODE_ENV === "production";
