/**
 * wechatbot 微信通知桥接服务
 * ------------------------------------------------------------------
 * 作用：把 BeeSupport 的通知事件转发到你的个人微信。
 *
 * 用法：
 *   1) 安装 SDK（只需一次）：pnpm add @wechatbot/wechatbot
 *   2) 启动桥接：pnpm wechat:bridge
 *      - 终端会打印二维码链接，用微信扫码登录（凭证会持久化，重启免扫）
 *   3) 在后台「通知渠道」里新增「微信（wechatbot）」，地址填：
 *        http://127.0.0.1:8787/send?to=<wxid 或备注名>
 *      接收人可以省略，改用环境变量 WECHATBOT_DEFAULT_TO 指定默认接收人。
 *
 * 环境变量：
 *   WECHATBOT_PORT        监听端口，默认 8787
 *   WECHATBOT_TOKEN       设置后请求需带 Authorization: Bearer <token>
 *   WECHATBOT_DEFAULT_TO  默认接收人（wxid 或备注名）
 *   WECHATBOT_STORAGE_DIR 登录凭证目录，默认 ./data/wechatbot
 *
 * 说明：桥接只做「单向发送」，不处理微信里收到的消息；
 * 微信账号需要先与该接收人有过会话（或接收人是文件传输助手）。
 */
import "dotenv/config";

import { createServer } from "node:http";

const PORT = Number(process.env.WECHATBOT_PORT ?? 8787);
const TOKEN = process.env.WECHATBOT_TOKEN ?? "";
const DEFAULT_TO = process.env.WECHATBOT_DEFAULT_TO ?? "";
const STORAGE_DIR = process.env.WECHATBOT_STORAGE_DIR ?? "./data/wechatbot";

function log(message, ...rest) {
  console.log(`[wechat-bridge] ${message}`, ...rest);
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

let WeChatBot;
try {
  ({ WeChatBot } = await import("@wechatbot/wechatbot"));
} catch (error) {
  console.error(
    "\n[wechat-bridge] 未找到 @wechatbot/wechatbot，请先安装：\n" +
      "  pnpm add @wechatbot/wechatbot\n",
  );
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const bot = new WeChatBot({
  storage: "file",
  storageDir: STORAGE_DIR,
  logLevel: "info",
  loginCallbacks: {
    onQrUrl: (url) => {
      log("请用微信扫码登录（凭证会保存，重启免扫）：");
      console.log(`\n${url}\n`);
    },
    onScanned: () => log("已扫码，请在手机上确认登录"),
  },
});

bot.on("error", (error) => log("bot 异常：", error?.message ?? error));
bot.on("session:expired", () => log("会话过期，正在尝试自动恢复…"));

await bot.login();
await bot.start();
log(`微信登录完成，凭证目录：${STORAGE_DIR}`);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (TOKEN) {
    const header = req.headers.authorization ?? "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const provided = bearer || url.searchParams.get("token") || "";
    if (provided !== TOKEN) {
      json(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
  }

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, running: Boolean(bot.isRunning) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/send") {
    try {
      const payload = await readJson(req);
      const to = String(payload.to ?? url.searchParams.get("to") ?? DEFAULT_TO ?? "").trim();
      const text = String(payload.text ?? payload.content ?? "").trim();

      if (!to) {
        json(res, 400, {
          ok: false,
          error: "缺少接收人：请在地址里带上 ?to=<wxid 或备注名>，或设置 WECHATBOT_DEFAULT_TO",
        });
        return;
      }
      if (!text) {
        json(res, 400, { ok: false, error: "缺少消息内容 text" });
        return;
      }

      await bot.send(to, { text });
      log(`已发送 → ${to}（${text.slice(0, 40).replace(/\n/g, " ")}…）`);
      json(res, 200, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("发送失败：", message);
      json(res, 500, { ok: false, error: message });
    }
    return;
  }

  json(res, 404, { ok: false, error: "not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  log(`桥接服务已就绪：http://127.0.0.1:${PORT}/send`);
  log(`后台渠道地址示例：http://127.0.0.1:${PORT}/send?to=${DEFAULT_TO || "<wxid 或备注名>"}`);
});

async function shutdown(signal) {
  log(`收到 ${signal}，正在退出…`);
  try {
    await bot.stop();
  } catch {
    /* 忽略 */
  }
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
