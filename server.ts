import "dotenv/config";
// 必须排在 next 之前，补上自定义 server 缺失的运行时基线（AsyncLocalStorage）
import "./src/server/runtime-baseline";

import { createServer } from "node:http";

import { createAdapter } from "@socket.io/redis-adapter";
import next from "next";
import { Server as SocketIOServer } from "socket.io";

import { ADMIN_PATH } from "./src/lib/app-paths";
import { createRedisClient } from "./src/lib/redis";
import { registerRealtime } from "./src/server/socket";
import { expireStaleAgents } from "./src/server/presence";
import { createClientIpResolver, setClientIp } from "./src/server/client-ip";
import { startNotificationWorker } from "./src/server/notification-worker";
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

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function main(): Promise<void> {
  await app.prepare();

  const httpServer = createServer((req, res) => {
    setClientIp(req, resolveClientIp);
    // 后台随机入口：对外只暴露 ADMIN_PATH，/admin 直接 404。
    // 放在这里做（而不是 middleware）是为了能在运行期读到环境变量，无需重新构建。
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

    void handle(req, res).catch((error: unknown) => {
      console.error("[next] 请求处理失败:", error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    });
  });

  const io = new SocketIOServer(httpServer, {
    path: "/socket.io",
    serveClient: false,
    pingInterval: 20_000,
    pingTimeout: 25_000,
    maxHttpBufferSize: 1_000_000,
    cors: { origin: true, credentials: true },
  });

  const pubClient = createRedisClient();
  const subClient = createRedisClient();
  if (pubClient && subClient) {
    io.adapter(createAdapter(pubClient, subClient));
    console.log("[realtime] 已启用 Redis adapter（支持多实例水平扩展）");
  } else {
    console.log("[realtime] 未配置 REDIS_URL，实时通道运行在单实例模式");
  }

  registerRealtime(io);
  const stopNotifications = startNotificationWorker();
  const stopReminders = startSubscriptionReminderWorker();
  const stopUnanswered = startUnansweredReminderWorker();
  const expirePresence = () =>
    void expireStaleAgents().catch((error: unknown) =>
      console.error("[presence] 在线状态清理失败:", error),
    );
  expirePresence();
  const presenceTimer = setInterval(expirePresence, 30_000);
  presenceTimer.unref();

  httpServer.listen(port, hostname, () => {
    const shownHost = hostname === "0.0.0.0" ? "localhost" : hostname;
    console.log(
      `> BeeSupport ready on http://${shownHost}:${port} (${dev ? "development" : "production"})`,
    );
    console.log(
      `  访客端接入脚本： http://${shownHost}:${port}/widget.js?key=<站点密钥>`,
    );
    console.log(`  客服工作台：     http://${shownHost}:${port}/agent`);
    console.log(`  管理后台：       http://${shownHost}:${port}${ADMIN_PATH}`);

    // 后台开了「启用微信通知」就随服务一起登录，避免重启后漏掉提醒
    void (async () => {
      const { ensureWechatBot } =
        await import("./src/server/services/wechatbot");
      await ensureWechatBot();
    })().catch((error: unknown) => {
      console.error("[wechatbot] 启动检查失败:", error);
    });
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(presenceTimer);
    console.log(`\n[server] 收到 ${signal}，正在优雅退出...`);
    const deadline = setTimeout(() => process.exit(1), 30_000);
    deadline.unref();
    try {
      await Promise.all([
        stopNotifications(),
        stopReminders(),
        stopUnanswered(),
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
  console.error("[server] 启动失败:", error);
  process.exit(1);
});
