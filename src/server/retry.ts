import { setTimeout as delay } from "node:timers/promises";

/** Bounded retries for external notifications; callers schedule this outside request commits. */
export async function retryNotification<T>(
  operation: () => Promise<T>,
  options: { shouldRetry?: (error: unknown) => boolean } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= 2 || options.shouldRetry?.(error) === false) throw error;
      await delay(500 * 2 ** attempt);
    }
  }
}
