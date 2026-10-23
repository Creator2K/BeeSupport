import type { WidgetSettings } from "@/lib/branding";
import type { SiteInput } from "@/server/actions/sites";

export const SITE_WEEKDAYS = [
  { value: 1, zh: "周一", en: "Mon" },
  { value: 2, zh: "周二", en: "Tue" },
  { value: 3, zh: "周三", en: "Wed" },
  { value: 4, zh: "周四", en: "Thu" },
  { value: 5, zh: "周五", en: "Fri" },
  { value: 6, zh: "周六", en: "Sat" },
  { value: 0, zh: "周日", en: "Sun" },
];

export type SiteDayRange = { start: string; end: string };

export type SiteFormState = {
  widgetSettings: WidgetSettings;
  name: string;
  slug: string;
  description: string;
  primaryColor: string;
  position: "right" | "left";
  welcomeMessage: string;
  offlineMessage: string;
  requireEmail: boolean;
  autoAssign: boolean;
  imageReviewEnabled: boolean;
  active: boolean;
  notifyEmail: string;
  allowedOrigins: string;
  workHoursEnabled: boolean;
  workHoursTimezone: string;
  days: Record<number, SiteDayRange[]>;
};

export type UpdateSiteForm = <K extends keyof SiteFormState>(
  key: K,
  value: SiteFormState[K],
) => void;

const DEFAULT_WELCOME = "你好！有什么可以帮你的吗？";
const DEFAULT_OFFLINE =
  "当前客服不在线，请留下你的邮箱和问题，我们会尽快回复。";

export function emptySiteForm(): SiteFormState {
  return {
    widgetSettings: {},
    name: "",
    slug: "",
    description: "",
    primaryColor: "#18181b",
    position: "right",
    welcomeMessage: DEFAULT_WELCOME,
    offlineMessage: DEFAULT_OFFLINE,
    requireEmail: true,
    autoAssign: true,
    imageReviewEnabled: false,
    active: true,
    notifyEmail: "",
    allowedOrigins: "",
    workHoursEnabled: false,
    workHoursTimezone: "Asia/Shanghai",
    days: {},
  };
}

export function parseSiteWorkHours(
  value: unknown,
): Pick<SiteFormState, "workHoursEnabled" | "workHoursTimezone" | "days"> {
  const config = (value ?? null) as {
    enabled?: boolean;
    timezone?: string;
    days?: Record<string, [string, string][]>;
  } | null;

  const days: Record<number, SiteDayRange[]> = {};
  for (const [key, ranges] of Object.entries(config?.days ?? {})) {
    if (Array.isArray(ranges)) {
      days[Number(key)] = ranges.map(([start, end]) => ({ start, end }));
    }
  }

  return {
    workHoursEnabled: Boolean(config?.enabled),
    workHoursTimezone: config?.timezone ?? "Asia/Shanghai",
    days,
  };
}

export function buildSitePayload(form: SiteFormState): SiteInput {
  const days: Record<string, [string, string][]> = {};
  for (const [day, ranges] of Object.entries(form.days)) {
    days[day] = ranges.map((range) => [range.start, range.end]);
  }

  return {
    widgetSettings: form.widgetSettings,
    name: form.name,
    slug: form.slug,
    description: form.description || null,
    primaryColor: form.primaryColor,
    position: form.position,
    welcomeMessage: form.welcomeMessage,
    offlineMessage: form.offlineMessage,
    requireEmail: form.requireEmail,
    autoAssign: form.autoAssign,
    imageReviewEnabled: form.imageReviewEnabled,
    active: form.active,
    notifyEmail: form.notifyEmail || null,
    allowedOrigins: form.allowedOrigins
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    workHours: {
      enabled: form.workHoursEnabled,
      timezone: form.workHoursTimezone,
      days,
    },
  };
}
