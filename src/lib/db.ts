import { PrismaClient } from "@prisma/client";

import { env } from "./env";

// Next 路由打包和自定义 server 可能分别加载此模块；生产环境也复用同一进程的连接池。
const globalForPrisma = globalThis as unknown as {
  __beePrisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.__beePrisma ??
  new PrismaClient({
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

globalForPrisma.__beePrisma = prisma;
