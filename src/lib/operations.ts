export function operationWindow(days: number, now = new Date()) {
  days = [7, 30, 90].includes(days) ? days : 30;
  const today = new Date(now.getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 10);
  const start = new Date(
    new Date(`${today}T00:00:00+08:00`).getTime() - (days - 1) * 86400000,
  );
  return {
    days,
    start,
    end: now,
    labels: Array.from({ length: days }, (_, i) =>
      new Date(start.getTime() + i * 86400000 + 8 * 3600000)
        .toISOString()
        .slice(0, 10),
    ),
  };
}
