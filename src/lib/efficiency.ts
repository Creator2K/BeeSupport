import { z } from "zod";
import { defaultReportDates, reportDateRange } from "./reporting";

export const efficiencyFilterSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    siteId: z.string().trim().max(128).default(""),
    agentId: z.string().trim().max(128).default(""),
  })
  .strict();
export type EfficiencyFilters = z.infer<typeof efficiencyFilterSchema>;
export function efficiencyFilters(input: unknown, now = new Date()) {
  const filters = efficiencyFilterSchema.parse(input);
  const range = reportDateRange(filters.from, filters.to, now);
  return { filters, range };
}
export function defaultEfficiencyFilters(now = new Date()): EfficiencyFilters {
  return { ...defaultReportDates(now), siteId: "", agentId: "" };
}
export type EfficiencyMetrics = {
  total: number;
  pending: number;
  open: number;
  closed: number;
  waiting: number;
  responseSamples: number;
  avgResponseSeconds: number | null;
  p90ResponseSeconds: number | null;
  closeSamples: number;
  avgCloseSeconds: number | null;
  ratingSamples: number;
  avgRating: number | null;
  satisfied: number;
};
export type EfficiencyGroup = EfficiencyMetrics & {
  id: string | null;
  name: string;
  tenantName: string | null;
  active: boolean | null;
};
export type EfficiencyData = {
  summary: EfficiencyMetrics;
  trend: { day: string; total: number; waiting: number; closed: number }[];
  sites: EfficiencyGroup[];
  agents: EfficiencyGroup[];
  siteGroups: number;
  agentGroups: number;
  filters: EfficiencyFilters;
  asOf: string;
};
export type EfficiencyOptions = {
  sites: {
    id: string;
    name: string;
    tenantId: string;
    tenantName: string | null;
  }[];
  agents: {
    id: string;
    name: string;
    active: boolean;
    tenantId: string;
    tenantName: string | null;
  }[];
};
export function efficiencyDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} 分钟`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} 小时`;
  return `${(seconds / 86400).toFixed(1)} 天`;
}
export function efficiencyRate(numerator: number, denominator: number) {
  return denominator > 0
    ? `${((numerator / denominator) * 100).toFixed(1)}%`
    : "—";
}
