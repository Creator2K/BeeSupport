import { isIP } from "node:net";

import { logger } from "./logger";
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
  // Units charged by this call, e.g. megabytes for an upload budget.
  cost = 1,
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
          "local n = redis.call('INCRBY', KEYS[1], ARGV[2]); if n == tonumber(ARGV[2]) then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return n",
          1,
          bucket,
          windowSeconds + 1,
          cost,
        ),
      );
      const remaining = Math.max(0, limit - count);
      return {
        ok: count <= limit,
        remaining,
        resetAt: now + windowSeconds * 1000,
      };
    } catch (error) {
      logger.error("rate_limit.redis_fallback", {}, error);
    }
  }

  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    const resetAt = now + windowSeconds * 1000;
    memory.set(key, { count: cost, resetAt });
    return { ok: cost <= limit, remaining: Math.max(0, limit - cost), resetAt };
  }

  entry.count += cost;
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

/**
 * 限流计数用的来源标识：IPv4 就是地址本身，IPv6 取前 64 位。
 * 一个 IPv6 用户通常拿到整个 /64，按单个地址计数的话换一个地址就能重新计。
 */
export function rateLimitSource(ip: string): string {
  const address = ip.split("%")[0]!;
  if (isIP(address) !== 6) return ip;
  const [head, tail] = address.split("::") as [string, string | undefined];
  const groups = head ? head.split(":") : [];
  if (tail !== undefined) {
    const rest = tail ? tail.split(":") : [];
    // 末尾的点分 IPv4 占两组
    const restLength = rest.length + (tail.includes(".") ? 1 : 0);
    groups.push(
      ...Array<string>(8 - groups.length - restLength).fill("0"),
      ...rest,
    );
  }
  const prefix = groups
    .slice(0, 4)
    .map((group) => parseInt(group, 16).toString(16));
  // ::1、IPv4 映射地址这类前 64 位全零的地址不属于同一个用户，按单个地址计
  return prefix.every((group) => group === "0")
    ? ip
    : `${prefix.join(":")}::/64`;
}
