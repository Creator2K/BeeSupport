import { prisma } from "../lib/db";
import { getRedis, redisEnabled } from "../lib/redis";

type CheckState = "ok" | "error" | "timeout" | "not_configured";
type Readiness = {
  status: "ok" | "unavailable";
  checks: { database: CheckState; redis: CheckState };
};

/** At most one underlying operation per dependency, even if it outlives the HTTP deadline. */
function dependencyCheck(check: () => Promise<unknown>, timeoutMs: number) {
  let inFlight: Promise<CheckState> | null = null;
  return async (): Promise<CheckState> => {
    if (!inFlight) {
      inFlight = Promise.resolve()
        .then(check)
        .then(
          () => "ok" as const,
          () => "error" as const,
        )
        .finally(() => {
          inFlight = null;
        });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        inFlight,
        new Promise<CheckState>((resolve) => {
          timer = setTimeout(() => resolve("timeout"), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
}

export function createReadinessProbe(
  checks: { database: () => Promise<unknown>; redis?: () => Promise<unknown> },
  options: { timeoutMs?: number; cacheMs?: number } = {},
): () => Promise<Readiness> {
  const database = dependencyCheck(checks.database, options.timeoutMs ?? 2000);
  const redis = checks.redis
    ? dependencyCheck(checks.redis, options.timeoutMs ?? 2000)
    : null;
  let cached: { result: Readiness; expires: number } | null = null;
  let pending: Promise<Readiness> | null = null;
  return async () => {
    if (cached && cached.expires > Date.now()) return cached.result;
    if (!pending) {
      pending = Promise.all([
        database(),
        redis?.() ?? ("not_configured" as const),
      ])
        .then(([database, redis]): Readiness => {
          const result: Readiness = {
            status:
              database === "ok" &&
              (redis === "ok" || redis === "not_configured")
                ? "ok"
                : "unavailable",
            checks: { database, redis },
          };
          cached = { result, expires: Date.now() + (options.cacheMs ?? 1000) };
          return result;
        })
        .finally(() => {
          pending = null;
        });
    }
    return pending;
  };
}

export const checkReadiness = createReadinessProbe({
  database: () => prisma.$queryRaw`SELECT 1`,
  ...(redisEnabled
    ? {
        redis: async () => {
          const client = getRedis();
          if (!client) throw new Error("Redis unavailable");
          await client.ping();
        },
      }
    : {}),
});
