import { z } from "zod";
import {
  featuresSchema,
  LEGACY_FEATURES,
  type TenantFeatures,
} from "./entitlements";

export const planInputSchema = z.object({
  name: z.string().trim().min(1, "请填写套餐名称").max(60),
  description: z.string().trim().max(500),
  priceCents: z.number().int().min(0).max(100000000),
  durationDays: z.number().int().min(1).max(3660),
  maxAgents: z.number().int().min(1).max(100000),
  maxSites: z.number().int().min(1).max(100000),
  monthlyConversations: z.number().int().min(1).max(100000000),
  storageMB: z.number().int().min(1).max(100000000),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(10000),
  features: featuresSchema.default(LEGACY_FEATURES),
});
export type PlanInput = z.input<typeof planInputSchema>;
export type PlanView = z.output<typeof planInputSchema> & {
  id: string;
  updatedAt: string;
};
export type OrderView = {
  id: string;
  orderNo: string;
  tenantName: string;
  status: string;
  planName: string;
  features: TenantFeatures;
  priceCents: number;
  durationDays: number;
  maxAgents: number;
  maxSites: number;
  monthlyConversations: number;
  storageMB: number;
  merchantNote: string;
  reviewNote: string;
  requestedByName: string;
  reviewedByName: string | null;
  paymentReference?: string;
  paymentReportedAt: string | null;
  paymentNote: string;
  paymentReportVersion: number;
  createdAt: string;
  validUntil: string;
  reviewedAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
};
export const orderStatusLabels: Record<string, string> = {
  PENDING: "待平台确认",
  CONFIRMED: "已开通",
  REJECTED: "已拒绝",
  CANCELLED: "已取消",
  EXPIRED: "已过期",
};
export function centsFromYuan(value: string): number | null {
  if (!/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(value)) return null;
  const [whole, decimal = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return cents <= 100000000 ? cents : null;
}
export function formatPrice(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}
export function renewalPeriod(
  expiresAt: Date | null,
  durationDays: number,
  now = new Date(),
) {
  const start = expiresAt && expiresAt > now ? expiresAt : now;
  return { start, end: new Date(start.getTime() + durationDays * 86400000) };
}
export function effectiveOrderStatus(
  order: { status: string; validUntil: Date | string },
  now = new Date(),
) {
  return order.status === "PENDING" && new Date(order.validUntil) <= now
    ? "EXPIRED"
    : order.status;
}
export function quotaConflict(
  plan: Pick<
    PlanInput,
    "maxAgents" | "maxSites" | "monthlyConversations" | "storageMB"
  >,
  usage: {
    agents: number;
    sites: number;
    conversations: number;
    storageBytes: number;
  },
) {
  if (usage.agents > plan.maxAgents) return "当前启用账号数超过该套餐上限";
  if (usage.sites > plan.maxSites) return "当前站点数超过该套餐上限";
  if (usage.conversations > plan.monthlyConversations)
    return "本月会话用量超过该套餐上限";
  if (usage.storageBytes > plan.storageMB * 1048576)
    return "当前存储用量超过该套餐上限";
  return null;
}
