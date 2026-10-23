import Redis from "ioredis";

import { env } from "./env";

/**
 * Redis 是可选依赖：
 * - 配置了 REDIS_URL：多实例部署时通过 adapter 广播实时事件，并用于限流/在线状态
 * - 未配置：自动退化为单实例内存实现，本地开发与单机部署仍可完整运行
 */
const globalForRedis = globalThis as unknown as {
  __beeRedis?: Redis;
};

export const redisEnabled = Boolean(env.REDIS_URL);

/** 业务用主连接（限流、在线状态等） */
export function getRedis(): Redis | null {
  if (!env.REDIS_URL) return null;
  if (!globalForRedis.__beeRedis) {
    globalForRedis.__beeRedis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      commandTimeout: 1500,
      connectTimeout: 1500,
      enableOfflineQueue: false,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    globalForRedis.__beeRedis.on("error", (error: Error) => {
      console.error("[redis] 连接异常:", error.message);
    });
  }
  return globalForRedis.__beeRedis;
}

/**
 * Socket.IO 需要独立的 pub / sub 连接，不能复用主连接。
 * 调用方负责在进程退出时断开。
 */
export function createRedisClient(): Redis | null {
  if (!env.REDIS_URL) return null;
  const client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  client.on("error", (error: Error) => {
    console.error("[redis:pubsub] 连接异常:", error.message);
  });
  return client;
}
