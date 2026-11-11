import { getRedis } from "../lib/redis";
import { prisma } from "../lib/db";
import { logger } from "../lib/logger";
import { emitAgentPresence } from "../lib/realtime/emit";

/**
 * 在线状态。
 *
 * - 客服：用「socket 集合」计数，避免多标签页时误判离线；计数归零才置为 OFFLINE。
 * - 访客：用一个带 TTL 的键表示在线，访客端定时心跳续期。
 * 未配置 Redis 时退化为进程内实现，单实例部署完全够用。
 */
const memoryAgentSockets = new Map<string, Map<string, number>>();
const memoryVisitors = new Map<string, number>();
const AGENT_TTL_MS = 90_000;
let lastSweep = 0;

function sweepMemory(): void {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [userId, sockets] of memoryAgentSockets) {
    for (const [id, expiresAt] of sockets)
      if (expiresAt <= now) sockets.delete(id);
    if (!sockets.size) memoryAgentSockets.delete(userId);
  }
  for (const [visitorId, expiresAt] of memoryVisitors)
    if (expiresAt <= now) memoryVisitors.delete(visitorId);
}

const updateAgentPresence = `
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
  if ARGV[3] == 'add' then
    redis.call('ZADD', KEYS[1], ARGV[2], ARGV[4])
    redis.call('PEXPIRE', KEYS[1], ARGV[5])
  else
    redis.call('ZREM', KEYS[1], ARGV[4])
  end
  return redis.call('ZCARD', KEYS[1])
`;

function agentKey(userId: string): string {
  return `presence:v2:agent:${userId}`;
}

function visitorKey(visitorId: string): string {
  return `presence:visitor:${visitorId}`;
}

export async function addAgentSocket(
  userId: string,
  socketId: string,
): Promise<number> {
  sweepMemory();
  const redis = getRedis();
  if (redis) {
    try {
      return Number(
        await redis.eval(
          updateAgentPresence,
          1,
          agentKey(userId),
          Date.now(),
          Date.now() + AGENT_TTL_MS,
          "add",
          socketId,
          AGENT_TTL_MS,
        ),
      );
    } catch (error) {
      logger.error(
        "presence.redis_fallback",
        { operation: "addAgentSocket" },
        error,
      );
    }
  }

  const set = memoryAgentSockets.get(userId) ?? new Map<string, number>();
  for (const [id, expires] of set) if (expires <= Date.now()) set.delete(id);
  set.set(socketId, Date.now() + AGENT_TTL_MS);
  memoryAgentSockets.set(userId, set);
  return set.size;
}

export async function removeAgentSocket(
  userId: string,
  socketId: string,
): Promise<number> {
  const redis = getRedis();
  if (redis) {
    try {
      return Number(
        await redis.eval(
          updateAgentPresence,
          1,
          agentKey(userId),
          Date.now(),
          0,
          "remove",
          socketId,
          AGENT_TTL_MS,
        ),
      );
    } catch (error) {
      logger.error(
        "presence.redis_fallback",
        { operation: "removeAgentSocket" },
        error,
      );
    }
  }

  const set = memoryAgentSockets.get(userId);
  if (!set) return 0;
  set.delete(socketId);
  for (const [id, expires] of set) if (expires <= Date.now()) set.delete(id);
  if (set.size === 0) memoryAgentSockets.delete(userId);
  return set.size;
}

export async function markVisitorOnline(
  visitorId: string,
  ttlSeconds = 90,
): Promise<void> {
  sweepMemory();
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(visitorKey(visitorId), "1", "EX", ttlSeconds);
      return;
    } catch (error) {
      logger.error(
        "presence.redis_fallback",
        { operation: "markVisitorOnline" },
        error,
      );
    }
  }
  memoryVisitors.set(visitorId, Date.now() + ttlSeconds * 1000);
}

export async function markVisitorOffline(visitorId: string): Promise<void> {
  memoryVisitors.delete(visitorId);
  try {
    await getRedis()?.del(visitorKey(visitorId));
  } catch {
    /* TTL is the fallback */
  }
}

export async function isVisitorOnline(visitorId: string): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    try {
      return (await redis.exists(visitorKey(visitorId))) === 1;
    } catch (error) {
      logger.error(
        "presence.redis_fallback",
        { operation: "isVisitorOnline" },
        error,
      );
    }
  }
  const expiresAt = memoryVisitors.get(visitorId);
  if (!expiresAt) return false;
  if (expiresAt < Date.now()) {
    memoryVisitors.delete(visitorId);
    return false;
  }
  return true;
}

/** 批量查询访客在线状态，用于会话列表 */
export async function filterOnlineVisitors(
  visitorIds: string[],
): Promise<Set<string>> {
  const online = new Set<string>();
  if (visitorIds.length === 0) return online;

  const redis = getRedis();
  if (redis) {
    try {
      const pipeline = redis.pipeline();
      for (const id of visitorIds) pipeline.exists(visitorKey(id));
      const results = await pipeline.exec();
      results?.forEach((entry, index) => {
        const value = entry?.[1];
        if (value === 1) online.add(visitorIds[index]!);
      });
      return online;
    } catch (error) {
      logger.error(
        "presence.redis_fallback",
        { operation: "filterOnlineVisitors" },
        error,
      );
    }
  }

  const now = Date.now();
  for (const id of visitorIds) {
    const expiresAt = memoryVisitors.get(id);
    if (expiresAt && expiresAt > now) online.add(id);
  }
  return online;
}

/** Expire persisted statuses after an abrupt process exit; never reset a healthy peer instance. */
export async function expireStaleAgents(): Promise<void> {
  const cutoff = new Date(Date.now() - AGENT_TTL_MS);
  const where = {
    status: { not: "OFFLINE" as const },
    OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }],
  };
  const stale = await prisma.user.findMany({ where, select: { id: true } });
  for (const user of stale) {
    const updated = await prisma.user.updateMany({
      where: { id: user.id, ...where },
      data: { status: "OFFLINE" },
    });
    if (updated.count) emitAgentPresence(user.id, "OFFLINE");
  }
}
