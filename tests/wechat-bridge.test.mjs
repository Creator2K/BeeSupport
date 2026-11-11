import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import * as nodeModule from "node:module";
import net from "node:net";

// 用假的微信 SDK 和空的 dotenv 跑真实的桥接脚本：不登录微信，也不读本机 .env
const preload = `data:text/javascript,${encodeURIComponent(`
import { registerHooks } from "node:module";
const sdk = "export class WeChatBot { isRunning = true; on() {} async login() { console.log('[stub] login'); } async start() {} async stop() {} async send() {} }";
const asModule = (source) => "data:text/javascript," + encodeURIComponent(source);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@wechatbot/wechatbot") return { url: asModule(sdk), shortCircuit: true };
    if (specifier === "dotenv/config") return { url: asModule(""), shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
`)}`;
const skip =
  typeof nodeModule.registerHooks === "function"
    ? false
    : "needs module.registerHooks to replace the WeChat SDK";

const TOKEN = "bridge-regression-test-only";
const bearer = { authorization: `Bearer ${TOKEN}` };

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function startBridge(env) {
  const port = await freePort();
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("WECHATBOT_"),
    ),
  );
  const child = spawn(
    process.execPath,
    ["--import", preload, "scripts/wechatbot-bridge.mjs"],
    {
      env: { ...inherited, ...env, WECHATBOT_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const bridge = { child, port, output: "", exitCode: null };
  child.stdout.on("data", (chunk) => (bridge.output += chunk));
  child.stderr.on("data", (chunk) => (bridge.output += chunk));
  bridge.exited = new Promise((resolve) =>
    child.on("exit", (code) => {
      bridge.exitCode = code;
      resolve(code);
    }),
  );
  bridge.stop = async () => {
    if (bridge.exitCode === null) child.kill();
    await bridge.exited;
  };
  return bridge;
}

async function untilListening(bridge) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && bridge.exitCode === null) {
    if (bridge.output.includes(`端口 ${bridge.port}`)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`bridge did not start: ${bridge.output.slice(0, 400)}`);
}

function request(port, { method = "GET", path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

function rawStatusLine(port, text) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    let data = "";
    socket.setTimeout(5000, () => socket.destroy());
    socket.on("connect", () => socket.write(text));
    socket.on("data", (chunk) => (data += chunk));
    socket.on("close", () => resolve(data.split("\r\n")[0]));
    socket.on("error", () => resolve(""));
  });
}

const sendBody = (text) => JSON.stringify({ to: "filehelper", text });
const sentCount = (bridge) => bridge.output.split("已发送").length - 1;

test("the bridge refuses to start without a token, before signing in", { skip }, async () => {
  for (const env of [{}, { WECHATBOT_TOKEN: "   " }]) {
    const bridge = await startBridge(env);
    try {
      assert.equal(await bridge.exited, 1);
      assert.match(bridge.output, /WECHATBOT_TOKEN/);
      assert.doesNotMatch(bridge.output, /\[stub\] login/);
    } finally {
      await bridge.stop();
    }
  }
});

test("the bridge checks the token on every request and caps the body size", { skip }, async () => {
  const bridge = await startBridge({ WECHATBOT_TOKEN: TOKEN });
  try {
    await untilListening(bridge);
    assert.match(bridge.output, /监听 127\.0\.0\.1 /);
    const { port } = bridge;

    assert.equal(await request(port, { path: "/health" }), 401);
    assert.equal(
      await request(port, {
        path: "/health",
        headers: { authorization: `Bearer ${TOKEN}x` },
      }),
      401,
    );
    assert.equal(await request(port, { path: "/health", headers: bearer }), 200);

    const send = (headers, body) =>
      request(port, { method: "POST", path: "/send", headers, body });
    assert.equal(await send({}, sendBody("hi")), 401);
    assert.equal(sentCount(bridge), 0);
    assert.equal(await send(bearer, sendBody("hi")), 200);
    assert.equal(sentCount(bridge), 1);

    // 正常的长通知仍然能发，超过 256 KB 的请求不读完就拒绝
    assert.equal(await send(bearer, sendBody("中".repeat(60_000))), 200);
    assert.equal(sentCount(bridge), 2);
    assert.equal(await send(bearer, sendBody("x".repeat(300 * 1024))), 413);
    assert.equal(await send({}, sendBody("x".repeat(300 * 1024))), 401);
    assert.equal(sentCount(bridge), 2);

    // 畸形请求只能得到 4xx，不能让进程退出
    assert.match(
      await rawStatusLine(
        port,
        "GET /health HTTP/1.1\r\nHost: a b\r\nConnection: close\r\n\r\n",
      ),
      /^HTTP\/1\.1 40[01] /,
    );
    assert.match(
      await rawStatusLine(
        port,
        "GET http://[::1 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
      ),
      /^HTTP\/1\.1 400 /,
    );
    assert.equal(await request(port, { path: "/health", headers: bearer }), 200);
    assert.equal(bridge.exitCode, null);
  } finally {
    await bridge.stop();
  }
});
