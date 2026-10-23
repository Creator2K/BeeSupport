import { z } from "zod";

export const cannedInputSchema = z
  .object({
    title: z.string().trim().min(1, "请填写话术标题").max(80),
    shortcut: z
      .string()
      .trim()
      .max(30)
      .regex(/^[a-zA-Z0-9_-]*$/, "快捷码只能包含字母、数字、下划线与中划线")
      .transform((value) => value.toLowerCase())
      .optional(),
    category: z.string().trim().max(30).default(""),
    content: z.string().trim().min(1, "请填写话术内容").max(2000),
    siteId: z.string().trim().min(1).max(128).nullable().optional(),
    shared: z.boolean().default(true),
  })
  .strict();
export type CannedInput = z.input<typeof cannedInputSchema>;
export const cannedSearchSchema = z
  .object({
    query: z.string().trim().max(120).default(""),
    category: z.string().trim().max(30).default(""),
    siteId: z.string().trim().max(128).default(""),
    visibility: z.enum(["", "shared", "private"]).default(""),
  })
  .strict();
export type CannedSearch = z.input<typeof cannedSearchSchema>;
export const useCannedSchema = z
  .object({
    id: z.string().min(1).max(128),
    siteId: z.string().min(1).max(128),
  })
  .strict();

export function cannedKeyword(value: string) {
  return value.trim().replace(/^\//, "");
}
export function appendCannedText(draft: string, content: string): string {
  const prefix = /^\/[a-zA-Z0-9_-]*$/.test(draft.trim()) ? "" : draft;
  const text = prefix ? `${prefix}\n${content}` : content;
  if (text.length > 5000)
    throw new Error("插入后超过 5000 字，请先缩短当前草稿");
  return text;
}
