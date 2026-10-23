import { format, formatDistanceToNow } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";

/**
 * 时间格式化：服务端渲染时固定用 UTC+8 之外会带来 hydration 差异，
 * 因此统一在服务端格式化好再传给客户端。
 */
const LOCALES = { "zh-CN": zhCN, en: enUS } as const;

function localeOf(locale?: string) {
  return locale === "en" ? LOCALES.en : LOCALES["zh-CN"];
}

export function formatDateTime(
  value: Date | string | null | undefined,
  locale?: string,
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "yyyy-MM-dd HH:mm", { locale: localeOf(locale) });
}

export function formatTime(
  value: Date | string | null | undefined,
  locale?: string,
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "HH:mm", { locale: localeOf(locale) });
}

/** 时分秒，用于日志时间轴 */
export function formatClock(
  value: Date | string | null | undefined,
  locale?: string,
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "HH:mm:ss", { locale: localeOf(locale) });
}

export function formatRelative(
  value: Date | string | null | undefined,
  locale?: string,
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return formatDistanceToNow(date, {
    addSuffix: true,
    locale: localeOf(locale),
  });
}

export function formatDuration(
  seconds: number,
  labels: { minute: string; second: string },
): string {
  if (seconds < 60) return `${Math.round(seconds)}${labels.second}`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(1)}${labels.minute}`;
  return `${(minutes / 60).toFixed(1)}h`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
