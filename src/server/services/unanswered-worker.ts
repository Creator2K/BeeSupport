import { generateUnansweredReminders } from "./unanswered-generation";

export function startUnansweredReminderWorker() {
  let stopping = false,
    cursor: string | undefined,
    running: Promise<void> | null = null,
    timer: ReturnType<typeof setTimeout> | undefined;
  const tick = () => {
    if (stopping || running) return;
    running = generateUnansweredReminders(new Date(), cursor)
      .then((result) => {
        cursor = result.cursor;
      })
      .catch((error) => {
        cursor = undefined;
        console.error("[unanswered-reminders] 检查失败:", error);
      })
      .finally(() => {
        running = null;
        if (!stopping) {
          timer = setTimeout(tick, cursor ? 1000 : 30000);
          timer.unref();
        }
      });
  };
  tick();
  return async () => {
    stopping = true;
    if (timer) clearTimeout(timer);
    await running;
  };
}
