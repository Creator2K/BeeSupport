import { env } from "../lib/env";
import { logger } from "../lib/logger";
import {
  cleanupAnonymousVisitors,
  cleanupAuditLogs,
  cleanupRiskEvents,
} from "./services/data-retention";
import { cleanupUnsentAttachments } from "./services/upload-cleanup";

const FIRST_RUN_DELAY_MS = 60_000;
const INTERVAL_MS = 60 * 60_000;

type Task = [
  name: string,
  run: (options: { shouldStop: () => boolean }) => Promise<number>,
];

// The retention tasks do nothing unless their *_RETENTION_DAYS variable is set.
const tasks: Task[] = [
  ["unsent_uploads", (options) => cleanupUnsentAttachments(options)],
  [
    "risk_events",
    (options) => cleanupRiskEvents(env.RISK_EVENT_RETENTION_DAYS, options),
  ],
  [
    "audit_logs",
    (options) => cleanupAuditLogs(env.AUDIT_LOG_RETENTION_DAYS, options),
  ],
  [
    "anonymous_visitors",
    (options) =>
      cleanupAnonymousVisitors(env.ANONYMOUS_VISITOR_RETENTION_DAYS, options),
  ],
];

/**
 * Hourly housekeeping, kept apart from the notification and AI workers so a
 * long pass never delays deliveries. Safe to run on every app instance: each
 * task re-checks its condition when it deletes.
 */
export function startMaintenanceWorker(): () => Promise<void> {
  let stopping = false;
  let running: Promise<void> | null = null;
  const run = () => {
    if (stopping || running) return;
    running = (async () => {
      for (const [name, task] of tasks) {
        if (stopping) break;
        // A failing task must not keep the others from running.
        try {
          const count = await task({ shouldStop: () => stopping });
          if (count) logger.info(`maintenance.${name}_removed`, { count });
        } catch (error) {
          logger.error("maintenance.failed", { task: name }, error);
        }
      }
    })()
      .catch((error: unknown) => logger.error("maintenance.failed", {}, error))
      .finally(() => {
        running = null;
      });
  };
  const first = setTimeout(run, FIRST_RUN_DELAY_MS);
  first.unref();
  const timer = setInterval(run, INTERVAL_MS);
  timer.unref();
  return async () => {
    stopping = true;
    clearTimeout(first);
    clearInterval(timer);
    await running;
  };
}
