import { getRedis } from "./redis";

/**
 * 简易限流：优先走 Redis（多实例一致），没有 Redis 时退化为进程内计数。
 * 返回 true 表示放行，false 表示超出限制。
 */
const memory = new Map<string, { count: number; resetAt: number }>();
let lastSweep = 0;

export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ ok: boolean; remaining: number; resetAt: number }> {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [entryKey, entry] of memory)
      if (entry.resetAt <= now) memory.delete(entryKey);
  }
  const redis = getRedis();

  if (redis) {
    const bucket = `rl:${key}:${Math.floor(now / (windowSeconds * 1000))}`;
    try {
      const count = Number(
        await redis.eval(
          "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return n",
          1,
          bucket,
          windowSeconds + 1,
        ),
      );
      const remaining = Math.max(0, limit - count);
      return {
        ok: count <= limit,
        remaining,
        resetAt: now + windowSeconds * 1000,
      };
    } catch (error) {
      console.error("[rate-limit] Redis 异常，退化为内存限流:", error);
    }
  }

  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    const resetAt = now + windowSeconds * 1000;
    memory.set(key, { count: 1, resetAt });
    return { ok: true, remaining: limit - 1, resetAt };
  }

  entry.count += 1;
  const ok = entry.count <= limit;
  return {
    ok,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.resetAt,
  };
}

/** Read failed-attempt budgets without charging successful logins against them. */
export async function rateLimitStatus(
  key: string,
  limit: number,
  windowSeconds: number,
) {
  const now = Date.now(),
    redis = getRedis();
  if (redis) {
    try {
      const count = Number(
        (await redis.get(
          `rl:${key}:${Math.floor(now / (windowSeconds * 1000))}`,
        )) ?? 0,
      );
      return {
        ok: count < limit,
        resetAt:
          (Math.floor(now / (windowSeconds * 1000)) + 1) * windowSeconds * 1000,
      };
    } catch {
      /* Same bounded in-memory fallback as rateLimit. */
    }
  }
  const entry = memory.get(key);
  return {
    ok: !entry || entry.resetAt <= now || entry.count < limit,
    resetAt:
      entry && entry.resetAt > now ? entry.resetAt : now + windowSeconds * 1000,
  };
}
export async function resetRateLimit(key: string, windowSeconds: number) {
  memory.delete(key);
  const redis = getRedis();
  if (redis)
    try {
      await redis.del(
        `rl:${key}:${Math.floor(Date.now() / (windowSeconds * 1000))}`,
      );
    } catch {
      /* Local fallback already cleared. */
    }
}

/** Only the custom HTTP server may set this header after checking the proxy chain. */
export function clientIp(headers: Headers): string {
  return headers.get("x-beesupport-client-ip") ?? "0.0.0.0";
}
