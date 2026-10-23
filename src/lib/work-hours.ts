export type WorkHoursRange = [string, string];

export type WorkHours = {
  enabled?: boolean;
  timezone?: string;
  /** 0 = 周日 … 6 = 周六 */
  days?: Record<string, WorkHoursRange[]>;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function toMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function zonedNow(
  date: Date,
  timeZone: string,
): { weekday: number; minutes: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);

    const pick = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? "";

    const weekday = WEEKDAY_INDEX[pick("weekday")] ?? date.getUTCDay();
    const hour = Number(pick("hour")) % 24;
    const minute = Number(pick("minute"));
    return { weekday, minutes: hour * 60 + minute };
  } catch {
    return {
      weekday: date.getDay(),
      minutes: date.getHours() * 60 + date.getMinutes(),
    };
  }
}

/** 是否处于客服工作时间内；未启用工作时间时始终为 true */
export function isWithinWorkHours(
  workHours: unknown,
  date: Date = new Date(),
): boolean {
  const config = (workHours ?? null) as WorkHours | null;
  if (!config?.enabled) return true;

  const { weekday, minutes } = zonedNow(
    date,
    config.timezone || "Asia/Shanghai",
  );
  const ranges = config.days?.[String(weekday)] ?? [];
  const today = ranges.some(([start, end]) => {
    const from = toMinutes(start);
    const to = toMinutes(end);
    if (from === null || to === null) return false;
    // 支持跨天时段，例如 22:00 - 02:00
    return to >= from ? minutes >= from && minutes < to : minutes >= from;
  });
  // The early-morning part belongs to the previous day's overnight shift.
  return (
    today ||
    (config.days?.[String((weekday + 6) % 7)] ?? []).some(([start, end]) => {
      const from = toMinutes(start);
      const to = toMinutes(end);
      return from !== null && to !== null && to < from && minutes < to;
    })
  );
}
