import { z } from "zod";
export const followUpStatuses = {
  OPEN: "待跟进",
  DONE: "已完成",
  CANCELLED: "已取消",
} as const;
export const followUpFilters = {
  OPEN: "待跟进",
  overdue: "已到期",
  today: "今日待办",
  DONE: "已完成",
  CANCELLED: "已取消",
} as const;
const version = z.number().int().min(0).max(2147483646);
export const followUpActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("save"),
      expectedVersion: version,
      ownerId: z.string().min(1).max(128),
      note: z.string().trim().min(1, "请填写跟进事项").max(1000),
      dueAt: z.iso.datetime(),
    })
    .strict(),
  z
    .object({
      action: z.enum(["complete", "cancel"]),
      expectedVersion: version,
    })
    .strict(),
]);
export type FollowUpAction = z.input<typeof followUpActionSchema>;
export const followUpFilterSchema = z
  .object({
    query: z.string().trim().max(120).default(""),
    status: z
      .enum(["OPEN", "DONE", "CANCELLED", "overdue", "today"])
      .default("OPEN"),
    siteId: z.string().trim().max(128).default(""),
    mine: z.enum(["", "1"]).default(""),
  })
  .strict();
export type FollowUpFilter = z.input<typeof followUpFilterSchema>;
export type FollowUpTask = {
  id: string;
  conversationId: string;
  ownerId: string | null;
  ownerName: string | null;
  ownerActive: boolean;
  note: string;
  dueAt: string;
  status: "OPEN" | "DONE" | "CANCELLED";
  version: number;
  finishedAt: string | null;
};
export type FollowUpDetails = {
  task: FollowUpTask | null;
  owners: { id: string; name: string }[];
  canEdit: boolean;
  defaultOwnerId: string;
};

export function followUpLocalTime(value: Date | string) {
  return new Date(new Date(value).getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 16);
}
export function parseFollowUpLocal(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ||
    !z.iso.date().safeParse(value.slice(0, 10)).success
  )
    throw new Error("请选择有效的北京时间");
  return new Date(`${value}:00+08:00`).toISOString();
}
export function validateFollowUpDue(dueAt: string, now = new Date()) {
  const value = new Date(dueAt);
  if (
    !Number.isFinite(value.getTime()) ||
    value <= now ||
    value.getTime() > now.getTime() + 365 * 86400000
  )
    throw new Error("跟进时间须晚于现在，且在 365 天以内");
  return value;
}
export function followUpToday(now = new Date()) {
  const gte = new Date(`${followUpLocalTime(now).slice(0, 10)}T00:00:00+08:00`);
  return { gte, lt: new Date(gte.getTime() + 86400000) };
}
