import { z } from "zod";

/** 邮箱：用正则而不是 .email()，避免 zod 大小版本间的废弃 API 差异 */
export const emailSchema = z
  .string()
  .trim()
  .min(3, "邮箱太短")
  .max(200, "邮箱太长")
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "邮箱格式不正确")
  .transform((value) => value.toLowerCase());

export const passwordSchema = z
  .string()
  .min(8, "密码至少 8 位")
  .max(72, "密码最长 72 位");

export const shortText = (max: number, label = "内容") =>
  z.string().trim().max(max, `${label}最长 ${max} 字`);

export const siteSlugSchema = z
  .string()
  .trim()
  .min(2, "标识至少 2 个字符")
  .max(40, "标识最长 40 个字符")
  .regex(/^[a-z0-9][a-z0-9-]*$/, "只能包含小写字母、数字与中划线");

export const messageBodySchema = z
  .string()
  .max(5000, "单条消息最长 5000 字")
  .default("");
