import "dotenv/config";
// 必须排在 next 之前，补上自定义 server 缺失的运行时基线（AsyncLocalStorage）
import "./src/server/runtime-baseline";

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { createAdapter } from "@socket.io/redis-adapter";
import next from "next";
import { Server as SocketIOServer } from "socket.io";

import { ADMIN_PATH } from "./src/lib/app-paths";
import { logger } from "./src/lib/logger";
import { createRedisClient } from "./src/lib/redis";
import { registerRealtime } from "./src/server/socket";
import { expireStaleAgents } from "./src/server/presence";
import { createClientIpResolver, setClientIp } from "./src/server/client-ip";
import {
  isSocketOriginAllowed,
  parseSocketOrigins,
} from "./src/server/socket-origin";
import { securityHeaders } from "./src/server/security-headers";
import { deploymentWarnings } from "./src/server/deployment-warnings";
import {
  requestPath,
  runWithRequestContext,
} from "./src/server/request-context";
import { startNotificationWorker } from "./src/server/notification-worker";
import { startAiWorker } from "./src/server/ai-worker";
import { startMaintenanceWorker } from "./src/server/maintenance-worker";
import { startSubscriptionReminderWorker } from "./src/server/services/subscription-reminders";
import { startUnansweredReminderWorker } from "./src/server/services/unanswered";

/**
 * 自定义 Node server：
 * Next 负责页面与 API，Socket.IO 挂同一个 HTTP 端口提供实时通道。
 * 开发用 `pnpm dev`（tsx 直接跑本文件），生产用 `pnpm start` / Dockerfile 的 CMD。
 */
const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.BIND_HOST || "0.0.0.0";
const resolveClientIp = createClientIpResolver(process.env.TRUSTED_PROXY_CIDRS);
const socketOrigins = parseSocketOrigins(
  process.env.APP_URL,
  process.env.SOCKET_ALLOWED_ORIGINS,
);
const httpsApp = (process.env.APP_URL ?? "").startsWith("https://");

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function main(): Promise<void> {
  await app.prepare();

  const httpServer = createServer((req, res) => {
    const startedAt = Date.now();
    const requestId = randomUUID();
    const method = req.method ?? "GET";
    const path = requestPath(req.url);
    const context = { requestId, method, path, startedAt };
    res.setHeader("x-request-id", requestId);
    for (const [name, value] of Object.entries(
      securityHeaders(path, { https: httpsApp }),
    ))
      res.setHeader(name, value);

    let accessLogged = false;
    const logAccess = (aborted: boolean) => {
      if (accessLogged) return;
      accessLogged = true;
      const statusCode = aborted ? 499 : res.statusCode;
      const fields = {
        requestId,
        method,
        path,
        statusCode,
        durationMs: Date.now() - startedAt,
        aborted,
      };
      if (aborted || statusCode >= 500) logger.error("http.request", fields);
      else if (statusCode >= 400) logger.warn("http.request", fields);
      else logger.info("http.request", fields);
    };
    res.once("finish", () => logAccess(false));
    res.once("close", () => {
      if (!res.writableFinished) logAccess(true);
    });

    void runWithRequestContext(context, async () => {
      try {
        setClientIp(req, resolveClientIp);
        // Rewrite the public admin path at runtime without rebuilding Next.
        const url = req.url ?? "/";
        if (ADMIN_PATH !== "/admin") {
          if (
            url === ADMIN_PATH ||
            url.startsWith(`${ADMIN_PATH}/`) ||
            url.startsWith(`${ADMIN_PATH}?`)
          ) {
            req.url = `/admin${url.slice(ADMIN_PATH.length)}`;
          } else if (
            url === "/admin" ||
            url.startsWith("/admin/") ||
            url.startsWith("/admin?")
          ) {
            res.statusCode = 404;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("Not Found");
            return;
          }
        }

        await handle(req, res);
      } catch (error) {
        logger.error(
          "http.request_failed",
          { statusCode: res.headersSent ? res.statusCode : 500 },
          error,
        );
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end("Internal Server Error");
        } else if (!res.writableEnded) {
          res.destroy(error instanceof Error ? error : undefined);
        }
      }
    });
  });

  const io = new SocketIOServer(httpServer, {
    path: "/socket.io",
    serveClient: false,
    pingInterval: 20_000,
    pingTimeout: 25_000,
    maxHttpBufferSize: 1_000_000,
    cors: { origin: socketOrigins, credentials: true },
    allowRequest: (req, callback) => {
      const allowed = isSocketOriginAllowed({
        origin: req.headers.origin,
        host: req.headers.host,
        allowedOrigins: socketOrigins,
      });
      if (!allowed) {
        logger.warn("realtime.origin_rejected", {
          origin: String(req.headers.origin).slice(0, 200),
        });
      }
      callback(allowed ? null : "origin not allowed", allowed);
    },
  });

  const pubClient = createRedisClient();
  const subClient = createRedisClient();
  if (pubClient && subClient) {
    io.adapter(createAdapter(pubClient, subClient));
    logger.info("realtime.redis_adapter", { enabled: true });
  } else {
    logger.info("realtime.redis_adapter", { enabled: false });
  }

  registerRealtime(io);
  const stopNotifications = startNotificationWorker();
  const stopAi = startAiWorker();
  const stopReminders = startSubscriptionReminderWorker();
  const stopUnanswered = startUnansweredReminderWorker();
  const stopMaintenance = startMaintenanceWorker();
  const expirePresence = () =>
    void expireStaleAgents().catch((error: unknown) =>
      logger.error("presence.cleanup_failed", {}, error),
    );
  expirePresence();
  const presenceTimer = setInterval(expirePresence, 30_000);
  presenceTimer.unref();

  httpServer.listen(port, hostname, () => {
    const shownHost = hostname === "0.0.0.0" ? "localhost" : hostname;
    const baseUrl = `http://${shownHost}:${port}`;
    logger.info("server.listening", {
      environment: dev ? "development" : "production",
      baseUrl,
      widgetUrl: `${baseUrl}/widget.js?key=<site-key>`,
      agentUrl: `${baseUrl}/agent`,
      adminUrl: `${baseUrl}${ADMIN_PATH}`,
    });
    for (const warning of deploymentWarnings({
      production: !dev,
      appUrl: process.env.APP_URL,
      databaseUrl: process.env.DATABASE_URL,
    }))
      logger.warn(warning.event, { hint: warning.hint });

    // 后台开了「启用微信通知」就随服务一起登录，避免重启后漏掉提醒
    void (async () => {
      const { ensureWechatBot } =
        await import("./src/server/services/wechatbot");
      await ensureWechatBot();
    })().catch((error: unknown) => {
      logger.error("wechat.startup_check_failed", {}, error);
    });
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(presenceTimer);
    logger.info("server.shutdown_started", { signal });
    const deadline = setTimeout(() => process.exit(1), 30_000);
    deadline.unref();
    try {
      await Promise.all([
        stopNotifications(),
        stopAi(),
        stopReminders(),
        stopUnanswered(),
        stopMaintenance(),
        new Promise<void>((resolve) => io.close(() => resolve())),
      ]);
      await app.close();
      httpServer.close();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  logger.error("server.startup_failed", {}, error);
  process.exit(1);
});
