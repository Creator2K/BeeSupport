/**
 * 端到端验证脚本（需要先启动服务：pnpm dev）。
 *
 *   node scripts/e2e.mjs
 *
 * 覆盖链路：
 *   1. 管理员登录 → 拿到会话 cookie
 *   2. 访客建会话（邮箱门槛）→ 访客令牌
 *   3. 访客发首条消息 → 生成会话并自动分配
 *   4. 客服 Socket 加入会话房间
 *   5. 访客再发消息 → 客服端实时收到 message:new
 *   6. 访客「正在输入」→ 客服端收到 typing
 *   7. 客服回消息 → 访客端实时收到 message:new
 *   8. 客服结束会话 → 访客端收到 conversation:updated(CLOSED)
 */
import "dotenv/config";

import { createHmac } from "node:crypto";
import { createServer } from "node:http";

import { io } from "socket.io-client";
import { useTestDatabase, restoreSetting } from "./test-environment.mjs";
import {
  closeTestServer,
  connectSocket,
  createTestResources,
  listenTestServer,
  waitFor,
} from "./realtime-test-helpers.mjs";

useTestDatabase();
if (!process.env.TEST_APP_URL)
  throw new Error("请将 TEST_APP_URL 指向连接独立测试数据库的应用实例。");

const APP = process.env.TEST_APP_URL.replace(/\/$/, "");
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@beesupport.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
// 测试站点由脚本自己创建（见 main 开头的 provision 步骤），不依赖 seed 数据；
// 需要复用已有站点时用 E2E_SITE_KEY 覆盖。
const SITE_KEY_OVERRIDE = process.env.E2E_SITE_KEY;
// 后台入口是随机路径（ADMIN_PATH），脚本跟着 .env 走
const ADMIN_PATH =
  (process.env.ADMIN_PATH ?? "/admin").replace(/\/+$/, "") || "/admin";
// 应用跑在 Docker 里时，Webhook 需要回连宿主机：E2E_WEBHOOK_HOST=host.docker.internal
const WEBHOOK_HOST = process.env.E2E_WEBHOOK_HOST ?? "127.0.0.1";

const results = [];

function check(name, ok, extra = "") {
  results.push({ name, ok });
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? ` — ${extra}` : ""}`);
}

function connect(url, options) {
  return connectSocket(io, url, options);
}

async function run(resources) {
  console.log(`\n▶ BeeSupport E2E @ ${APP}\n`);

  // 1. 管理员登录
  const loginResponse = await fetch(`${APP}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  check("管理员登录", loginResponse.ok, `HTTP ${loginResponse.status}`);
  if (!loginResponse.ok) throw new Error("管理员登录失败，停止 E2E 测试");

  const cookies = loginResponse.headers.getSetCookie?.() ?? [];
  const cookieHeader = cookies.map((item) => item.split(";")[0]).join("; ");
  check("拿到会话 cookie", cookieHeader.includes("beesupport_session"));

  // 2. 自建测试站点：一个自动分配、一个排队；脚本结束时连数据一起清掉
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  resources.add(() => prisma.$disconnect());
  const stamp = Date.now();

  const autoSite = await prisma.site.create({
    data: {
      name: "E2E 自动分配站点",
      slug: `e2e-auto-${stamp}`,
      publicKey: `e2e-auto-${stamp}`,
      autoAssign: true,
      requireEmail: true,
      allowedOrigins: [],
    },
    select: { id: true, publicKey: true },
  });
  resources.add(() => prisma.site.deleteMany({ where: { id: autoSite.id } }));

  const queueSite = await prisma.site.create({
    data: {
      name: "E2E 排队站点",
      slug: `e2e-queue-${stamp}`,
      publicKey: `e2e-queue-${stamp}`,
      autoAssign: false,
      requireEmail: true,
      allowedOrigins: [],
    },
    select: { id: true, publicKey: true },
  });
  resources.add(() => prisma.site.deleteMany({ where: { id: queueSite.id } }));

  const siteKey = SITE_KEY_OVERRIDE ?? autoSite.publicKey;
  const queueSiteKey = queueSite.publicKey;
  check("自建测试站点", Boolean(siteKey) && Boolean(queueSiteKey));

  // 3. 访客建会话
  const localKey = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const sessionResponse = await fetch(`${APP}/api/widget/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      key: siteKey,
      localKey,
      email: `e2e-${Date.now()}@example.com`,
      name: "E2E 访客",
      meta: { pageUrl: "https://example.com/e2e", userAgent: "e2e-script" },
    }),
  });
  const session = await sessionResponse.json();
  check("访客创建会话身份", sessionResponse.ok && Boolean(session.token));
  if (!session.token) throw new Error("访客身份创建失败");

  const visitorHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${session.token}`,
  };

  // 访客连上 Socket（用于接收客服回复）
  const visitorSocket = await connect(APP, { auth: { token: session.token } });
  resources.add(() => visitorSocket.close());
  check("访客 Socket 连接成功", visitorSocket.connected);

  // 3. 访客发首条消息
  const firstSend = await fetch(`${APP}/api/widget/conversation`, {
    method: "POST",
    headers: visitorHeaders,
    body: JSON.stringify({
      body: "E2E：你好，我想咨询一下多站点接入",
      source: "WIDGET",
    }),
  });
  const firstState = await firstSend.json();
  const conversationId = firstState.conversation?.id;
  check(
    "访客发送首条消息并生成会话",
    Boolean(conversationId),
    `status=${firstState.conversation?.status}（无在线客服时为 PENDING，有则已自动分配）`,
  );
  if (!conversationId) throw new Error("访客会话创建失败");

  // 4. 客服 Socket 加入会话并发送第二条消息
  const agentSocket = await connect(APP, {
    extraHeaders: { cookie: cookieHeader },
  });
  resources.add(() => agentSocket.close());
  check("客服 Socket 连接成功", agentSocket.connected);

  const joinAck = await Promise.race([
    new Promise((resolve) => {
      agentSocket.emit("conversation:join", { conversationId }, resolve);
    }),
    new Promise((resolve) =>
      setTimeout(() => resolve({ ok: false, error: "超时" }), 6000),
    ),
  ]);
  check("客服加入会话房间", joinAck?.ok === true, joinAck?.error ?? "");

  // 5. 访客再发消息 → 客服实时收到
  const agentMessagePromise = waitFor(agentSocket, "message:new");
  await fetch(`${APP}/api/widget/conversation`, {
    method: "POST",
    headers: visitorHeaders,
    body: JSON.stringify({
      conversationId,
      body: "E2E：第二条消息（实时验证）",
    }),
  });
  try {
    const payload = await agentMessagePromise;
    check(
      "客服实时收到 message:new",
      payload?.message?.body?.includes("第二条消息"),
      `sender=${payload?.message?.sender}`,
    );
  } catch (error) {
    check("客服实时收到 message:new", false, error.message);
  }

  // 6. 访客输入中 → 客服收到 typing
  const typingPromise = waitFor(agentSocket, "typing");
  visitorSocket.emit("typing", { conversationId, isTyping: true });
  try {
    const payload = await typingPromise;
    check(
      "客服实时收到 typing",
      payload?.from === "VISITOR" && payload?.isTyping === true,
    );
  } catch (error) {
    check("客服实时收到 typing", false, error.message);
  }

  // 7. 客服回复 → 访客实时收到
  const visitorMessagePromise = waitFor(visitorSocket, "message:new");
  const replyResponse = await fetch(
    `${APP}/api/agent/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader,
      },
      body: JSON.stringify({ body: "E2E：客服回复（实时验证）" }),
    },
  );
  check("客服发送消息", replyResponse.ok);
  try {
    const payload = await visitorMessagePromise;
    check(
      "访客实时收到 message:new",
      payload?.message?.sender === "AGENT" &&
        payload?.message?.body?.includes("客服回复"),
    );
  } catch (error) {
    check("访客实时收到 message:new", false, error.message);
  }

  // 8. 客服结束会话 → 访客收到状态更新
  const closedPromise = waitFor(visitorSocket, "conversation:updated");
  await fetch(`${APP}/api/agent/conversations/${conversationId}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader },
    body: JSON.stringify({ action: "close" }),
  });
  try {
    const payload = await closedPromise;
    check(
      "访客实时收到会话关闭事件",
      payload?.conversation?.status === "CLOSED",
      `status=${payload?.conversation?.status}`,
    );
  } catch (error) {
    check("访客实时收到会话关闭事件", false, error.message);
  }

  // 9. 排队 + 接入（docs 站点关闭了自动分配，会话会停在 PENDING）
  const docsSessionResponse = await fetch(`${APP}/api/widget/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      key: queueSiteKey,
      localKey: `e2e-docs-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      email: `e2e-docs-${Date.now()}@example.com`,
      name: "E2E 文档站访客",
    }),
  });
  const docsSession = await docsSessionResponse.json();

  const docsSend = await fetch(`${APP}/api/widget/conversation`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${docsSession.token}`,
    },
    body: JSON.stringify({ body: "E2E：文档站的排队消息", source: "WIDGET" }),
  });
  const docsState = await docsSend.json();
  const docsConversationId = docsState.conversation?.id;
  check(
    "关闭自动分配时会话进入排队(PENDING)",
    docsState.conversation?.status === "PENDING",
    `status=${docsState.conversation?.status}`,
  );
  check(
    "排队会话未分配客服",
    docsState.conversation?.assignedAgent === null ||
      docsState.conversation?.assignedAgent === undefined,
  );

  if (docsConversationId) {
    const claimResponse = await fetch(
      `${APP}/api/agent/conversations/${docsConversationId}/actions`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieHeader },
        body: JSON.stringify({ action: "claim" }),
      },
    );
    const claimed = await claimResponse.json();
    check(
      "客服接入会话后状态变为 OPEN",
      claimed?.conversation?.status === "OPEN" &&
        Boolean(claimed?.conversation?.assignedAgent),
      `agent=${claimed?.conversation?.assignedAgent?.name ?? "-"}`,
    );

    // 转交给没有该站点权限的客服应当被拒绝
    const otherAgent = await prisma.user.findUnique({
      where: {
        email: process.env.SEED_AGENT2_EMAIL ?? "agent2@beesupport.local",
      },
      select: { id: true, name: true },
    });

    const transferResponse = await fetch(
      `${APP}/api/agent/conversations/${docsConversationId}/actions`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieHeader },
        body: JSON.stringify({
          action: "transfer",
          targetAgentId: otherAgent?.id ?? "missing",
        }),
      },
    );
    const transferResult = await transferResponse.json();
    check(
      "转交给无权限客服被拒绝",
      transferResponse.status === 400,
      `HTTP ${transferResponse.status} ${transferResult?.error ?? ""}`,
    );
  }

  // 10. 文件上传与鉴权
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const pngBytes = Buffer.from(pngBase64, "base64");
  const uploadForm = new FormData();
  uploadForm.set(
    "file",
    new File([pngBytes], "e2e-screenshot.png", { type: "image/png" }),
  );

  const uploadResponse = await fetch(`${APP}/api/widget/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${session.token}` },
    body: uploadForm,
  });
  const uploadResult = await uploadResponse.json();
  const attachmentId = uploadResult.attachment?.id;
  check("访客上传图片成功", Boolean(attachmentId), uploadResult.error ?? "");

  if (attachmentId) {
    const ownRead = await fetch(`${APP}/api/files/${attachmentId}`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    check(
      "访客可读取自己上传的文件",
      ownRead.ok && ownRead.headers.get("content-type") === "image/png",
    );

    const agentRead = await fetch(`${APP}/api/files/${attachmentId}`, {
      headers: { cookie: cookieHeader },
    });
    check("客服可读取该文件", agentRead.ok);

    const anonymousRead = await fetch(`${APP}/api/files/${attachmentId}`);
    check("匿名请求文件被拒绝", anonymousRead.status === 403);
  }

  // 11. Webhook 推送（含 HMAC-SHA256 签名校验）
  const receivedHooks = [];
  const listener = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      receivedHooks.push({ headers: req.headers, body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  resources.add(() => closeTestServer(listener));
  const webhookPort = await listenTestServer(listener);

  try {
    const demoConversation = await prisma.conversation.findFirst({
      where: { visitor: { email: session.visitor.email } },
      orderBy: { createdAt: "desc" },
      select: { id: true, siteId: true },
    });

    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        name: "e2e-webhook",
        type: "GENERIC",
        url: `http://${WEBHOOK_HOST}:${webhookPort}/hook`,
        secret: "e2e-secret",
        events: ["message.created"],
        siteId: demoConversation?.siteId ?? null,
        active: true,
      },
      select: { id: true },
    });
    resources.add(() =>
      prisma.webhookEndpoint.deleteMany({ where: { id: endpoint.id } }),
    );

    await fetch(`${APP}/api/widget/conversation`, {
      method: "POST",
      headers: visitorHeaders,
      body: JSON.stringify({
        conversationId: demoConversation?.id,
        body: "E2E：这条消息应该触发 Webhook",
      }),
    });

    let hook = null;
    for (let i = 0; i < 20 && !hook; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      hook = receivedHooks.find((item) => {
        try {
          return JSON.parse(item.body).event === "message.created";
        } catch {
          return false;
        }
      });
    }

    check("Webhook 收到 message.created 事件", Boolean(hook));

    if (hook) {
      const payload = JSON.parse(hook.body);
      check(
        "Webhook 载荷包含会话与站点信息",
        Boolean(payload.data?.conversationId) && Boolean(payload.siteName),
        `siteName=${payload.siteName ?? "-"}`,
      );

      const expected = createHmac("sha256", "e2e-secret")
        .update(hook.body)
        .digest("hex");
      check(
        "Webhook HMAC 签名正确",
        hook.headers["x-beesupport-signature"] === expected,
      );
    }

    // 停用后不应再推送
    await prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: { active: false },
    });
    const before = receivedHooks.length;
    await fetch(`${APP}/api/widget/conversation`, {
      method: "POST",
      headers: visitorHeaders,
      body: JSON.stringify({
        conversationId: demoConversation?.id,
        body: "E2E：停用后不应触发 Webhook",
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    check("停用的 Webhook 不再推送", receivedHooks.length === before);

    await prisma.webhookEndpoint.delete({ where: { id: endpoint.id } });
  } finally {
    await closeTestServer(listener);
  }

  // 13. 微信通知渠道（wechatbot 桥接），用本地 mock 桥接服务验证
  const wechatReceived = [];
  const wechatBridge = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      wechatReceived.push({ headers: req.headers, body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  resources.add(() => closeTestServer(wechatBridge));
  const wechatPort = await listenTestServer(wechatBridge);

  try {
    const wechatEndpoint = await prisma.webhookEndpoint.create({
      data: {
        name: "e2e-wechat",
        type: "WECHAT",
        url: `http://${WEBHOOK_HOST}:${wechatPort}/send?to=e2e-receiver`,
        secret: "e2e-wechat-token",
        events: ["message.created"],
        siteId: queueSite.id,
        active: true,
      },
      select: { id: true },
    });
    resources.add(() =>
      prisma.webhookEndpoint.deleteMany({ where: { id: wechatEndpoint.id } }),
    );

    await fetch(`${APP}/api/widget/conversation`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${docsSession.token}`,
      },
      body: JSON.stringify({
        conversationId: docsConversationId,
        body: "E2E：这条消息应该推送到微信桥接",
      }),
    });

    let wechatHit = null;
    for (let i = 0; i < 20 && !wechatHit; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      wechatHit = wechatReceived[0] ?? null;
    }

    check("微信桥接收到推送", Boolean(wechatHit));

    if (wechatHit) {
      const payload = JSON.parse(wechatHit.body);
      check(
        "微信推送带上接收人（to）",
        payload.to === "e2e-receiver",
        `to=${payload.to}`,
      );
      check(
        "微信推送文本为纯文本（无 Markdown 星号）",
        typeof payload.text === "string" && !payload.text.includes("**"),
      );
      check(
        "微信推送带上 Bearer 令牌",
        wechatHit.headers.authorization === "Bearer e2e-wechat-token",
      );
    }

    await prisma.webhookEndpoint.delete({ where: { id: wechatEndpoint.id } });
  } finally {
    await closeTestServer(wechatBridge);
  }

  // 14. AI 助手：本地 mock 一个 OpenAI 兼容服务，验证自动回复与知识库召回
  const aiRequests = [];
  const aiMock = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      if (req.url?.includes("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            data: [{ id: "mock-model-a" }, { id: "mock-model-b" }],
          }),
        );
        return;
      }

      aiRequests.push({ headers: req.headers, body });

      let parsed = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = null;
      }

      // 第一轮带工具：先让模型要一次知识库检索，验证 tool calling 闭环
      const hasToolResult = (parsed?.messages ?? []).some(
        (message) => message.role === "tool",
      );
      if (
        Array.isArray(parsed?.tools) &&
        parsed.tools.length > 0 &&
        !hasToolResult
      ) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_e2e_knowledge",
                      type: "function",
                      function: {
                        name: "search_knowledge",
                        arguments: JSON.stringify({
                          query: "退款 政策",
                          top_k: 2,
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: "支持 7 天无理由退款，随时可以申请。",
              },
            },
          ],
        }),
      );
    });
  });
  resources.add(() => closeTestServer(aiMock));
  const aiPort = await listenTestServer(aiMock);

  const knowledgeEntry = await prisma.aiKnowledge.create({
    data: {
      title: "退款政策",
      content: "购买后 7 天内可以无理由退款，直接回复订单号即可。",
      keywords: ["退款", "退货", "refund"],
      enabled: true,
      siteId: null,
      // 直接建一条切片，验证 RAG 走的是切片而不是整篇内容
      chunks: {
        create: [
          {
            index: 0,
            content:
              "购买后 7 天内支持无理由退款：在订单页面点「申请退款」。（切片版）",
          },
        ],
      },
    },
    select: { id: true },
  });
  resources.add(() =>
    prisma.aiKnowledge.deleteMany({ where: { id: knowledgeEntry.id } }),
  );

  const savedAiSetting = await prisma.setting.findUnique({
    where: { key: "ai" },
  });
  let aiRestored = false;
  const restoreAi = async () => {
    if (aiRestored) return;
    await restoreSetting(prisma, "ai", savedAiSetting);
    aiRestored = true;
  };
  resources.add(restoreAi);
  try {
    await prisma.setting.upsert({
      where: { key: "ai" },
      create: {
        key: "ai",
        value: {
          enabled: true,
          baseUrl: `http://${WEBHOOK_HOST}:${aiPort}/v1`,
          apiKey: "e2e-ai-key",
          model: "mock-model-a",
          assistantName: "E2E AI 助手",
          systemPrompt: "你是 {siteName} 的客服助手，回答保持一句话。",
          autoReply: "always",
          temperature: 0,
          maxTokens: 200,
          topK: 3,
          historyLimit: 10,
        },
      },
      update: {
        value: {
          enabled: true,
          baseUrl: `http://${WEBHOOK_HOST}:${aiPort}/v1`,
          apiKey: "e2e-ai-key",
          model: "mock-model-a",
          assistantName: "E2E AI 助手",
          systemPrompt: "你是 {siteName} 的客服助手，回答保持一句话。",
          autoReply: "always",
          temperature: 0,
          maxTokens: 200,
          topK: 3,
          historyLimit: 10,
        },
      },
    });

    // 新建一个访客会话，消息里带上知识库关键词
    const aiSession = await fetch(`${APP}/api/widget/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: autoSite.publicKey,
        localKey: `e2e-ai-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        email: `e2e-ai-${Date.now()}@example.com`,
        name: "E2E AI 访客",
      }),
    }).then((response) => response.json());

    const aiHeaders = {
      "content-type": "application/json",
      authorization: `Bearer ${aiSession.token}`,
    };

    await fetch(`${APP}/api/widget/conversation`, {
      method: "POST",
      headers: aiHeaders,
      body: JSON.stringify({ body: "你们支持退款吗？", source: "WIDGET" }),
    });

    // 等 AI 自动回复落库
    let aiMessage = null;
    let aiState = null;
    for (let i = 0; i < 30 && !aiMessage; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const state = await fetch(`${APP}/api/widget/conversation`, {
        headers: { authorization: `Bearer ${aiSession.token}` },
      }).then((response) => response.json());
      aiState = state;
      aiMessage = (state.messages ?? []).find(
        (message) => message.sender === "AI",
      );
    }

    check("AI 自动回复落库并可见", Boolean(aiMessage), aiMessage?.body ?? "");
    check(
      "AI 回复内容来自模型",
      Boolean(aiMessage?.body?.includes("7 天无理由退款")),
      aiMessage?.body ?? "",
    );
    check(
      "AI 消息带显示名称",
      aiMessage?.authorName === "E2E AI 助手",
      aiMessage?.authorName ?? "",
    );
    check(
      "AI 回复没有把会话状态改成人工接入",
      aiState?.conversation?.status === "PENDING" ||
        aiState?.conversation?.status === "OPEN",
      `status=${aiState?.conversation?.status}`,
    );
    check(
      "访客无法读取 AI 内部元数据与客服账号 ID",
      Boolean(aiMessage) &&
        aiMessage.meta == null &&
        aiMessage.authorId == null,
    );

    const agentAiResponse = await fetch(
      `${APP}/api/agent/conversations/${aiState?.conversation?.id}`,
      { headers: { cookie: cookieHeader } },
    );
    const agentAiState = await agentAiResponse.json();
    const agentAiMessage = (agentAiState.messages ?? []).find(
      (message) => message.id === aiMessage?.id,
    );
    check(
      "客服可读取 AI 对话详情",
      agentAiResponse.ok && Boolean(agentAiMessage),
      `HTTP ${agentAiResponse.status}`,
    );

    // Other queued conversations may reach the provider first after AI is enabled.
    // Match this visitor's question instead of depending on worker scheduling order.
    const questionRequests = aiRequests.filter((item) => {
      try {
        return (JSON.parse(item.body).messages ?? []).some(
          (message) => message.role === "user" && message.content === "你们支持退款吗？",
        );
      } catch {
        return false;
      }
    });
    const aiRequest = questionRequests[0];
    check("模型收到请求", Boolean(aiRequest));

    if (process.env.E2E_DEBUG === "1") {
      console.log(
        "DEBUG aiRequests:",
        aiRequests.length,
        JSON.stringify(
          aiRequests.map((item) => {
            const parsed = JSON.parse(item.body);
            return {
              model: parsed.model,
              roles: parsed.messages?.map((message) => message.role),
              system: parsed.messages?.[0]?.content?.slice(0, 120),
            };
          }),
        ),
      );
    }

    if (aiRequest) {
      const payload = JSON.parse(aiRequest.body);
      const systemContent = payload.messages?.[0]?.content ?? "";
      check(
        "请求里注入了知识库内容与站点名",
        systemContent.includes("无理由退款") &&
          systemContent.includes("E2E 自动分配站点") &&
          !systemContent.includes("{siteName}"),
        `system=${systemContent.replace(/\n/g, " ").slice(0, 220)}`,
      );
      check(
        "请求里带上了访客提问",
        JSON.stringify(payload.messages).includes("你们支持退款吗"),
      );
      check(
        "请求里注入的是知识库切片",
        systemContent.includes("切片版"),
        `system=${systemContent.replace(/\n/g, " ").slice(0, 160)}`,
      );
      check(
        "请求里带上 API 密钥",
        aiRequest.headers.authorization === "Bearer e2e-ai-key",
      );
      check(
        "请求里带上了工具定义",
        Array.isArray(payload.tools) &&
          payload.tools.some(
            (tool) => tool.function?.name === "search_knowledge",
          ),
        `tools=${(payload.tools ?? []).map((tool) => tool.function?.name).join(",")}`,
      );
    }

    // 工具调用闭环：模型先要求检索知识库，服务端执行后把结果回填再问一次
    const toolRound = questionRequests.find((item) => {
      try {
        const parsed = JSON.parse(item.body);
        return (parsed.messages ?? []).some(
          (message) => message.role === "tool",
        );
      } catch {
        return false;
      }
    });
    check("工具执行结果回填给模型", Boolean(toolRound));
    if (toolRound) {
      const parsed = JSON.parse(toolRound.body);
      const toolMessage = (parsed.messages ?? []).find(
        (message) => message.role === "tool",
      );
      check(
        "回填内容来自知识库检索",
        typeof toolMessage?.content === "string" &&
          toolMessage.content.includes("切片版"),
        (toolMessage?.content ?? "").replace(/\n/g, " ").slice(0, 120),
      );
    }
    check(
      "AI 消息记录了工具调用轨迹",
      agentAiMessage?.meta?.ai?.tools?.[0]?.name === "search_knowledge",
      JSON.stringify(agentAiMessage?.meta?.ai?.tools ?? []).slice(0, 160),
    );
    check(
      "AI 消息记录了所用模型",
      agentAiMessage?.meta?.ai?.model === "mock-model-a",
      agentAiMessage?.meta?.ai?.model ?? "—",
    );

    // 客服端的「AI 建议」接口（同一套配置，走 agent 鉴权）
    const suggestResponse = await fetch(
      `${APP}/api/agent/conversations/${docsConversationId}/suggest`,
      { method: "POST", headers: { cookie: cookieHeader } },
    );
    const suggestResult = await suggestResponse.json();
    check(
      "客服端 AI 建议接口可用",
      suggestResponse.ok &&
        typeof suggestResult.text === "string" &&
        suggestResult.text.length > 0,
      suggestResult.error ?? (suggestResult.text ?? "").slice(0, 40),
    );

    // 模型列表接口（后台「获取模型」用同一套逻辑）
    const modelsResponse = await fetch(
      `http://${WEBHOOK_HOST}:${aiPort}/v1/models`,
      { headers: { authorization: "Bearer e2e-ai-key" } },
    ).then((response) => response.json());
    check(
      "模型列表可获取",
      Array.isArray(modelsResponse.data) && modelsResponse.data.length === 2,
    );
  } finally {
    await restoreAi();
    await prisma.aiKnowledge.delete({ where: { id: knowledgeEntry.id } });
    await closeTestServer(aiMock);
  }

  // 15. 中英双语：英文浏览器语言下应渲染英文界面
  const englishPage = await fetch(`${APP}/login`, {
    headers: { "accept-language": "en-US,en;q=0.9" },
  });
  const englishHtml = await englishPage.text();
  check("访客/客服界面支持英文", englishHtml.includes("Sign in to BeeSupport"));

  const chinesePage = await fetch(`${APP}/login`, {
    headers: { "accept-language": "zh-CN,zh;q=0.9" },
  });
  const chineseHtml = await chinesePage.text();
  check("界面支持中文", chineseHtml.includes("登录 BeeSupport"));

  // 13. 管理端接口（会话列表 + 话术）
  const listResponse = await fetch(
    `${APP}/api/agent/conversations?pageSize=5`,
    {
      headers: { cookie: cookieHeader },
    },
  );
  const list = await listResponse.json();
  check(
    "会话列表接口可用",
    Array.isArray(list.items) && list.items.length > 0,
    `HTTP ${listResponse.status} items=${Array.isArray(list.items) ? list.items.length : "n/a"} ${list.error ?? ""}`,
  );

  const cannedResponse = await fetch(`${APP}/api/agent/canned`, {
    headers: { cookie: cookieHeader },
  });
  const canned = await cannedResponse.json();
  check(
    "快捷话术接口可用",
    Array.isArray(canned.items) && canned.items.length > 0,
  );

  const adminPage = await fetch(`${APP}${ADMIN_PATH}/settings`, {
    headers: { cookie: cookieHeader },
  });
  check(`后台页面需要管理员会话（${ADMIN_PATH}/settings）`, adminPage.ok);

  // 微信扫码登录页与状态接口（真实扫码需要人工，这里只验证鉴权与页面可用）
  const aiAdminPage = await fetch(`${APP}${ADMIN_PATH}/ai`, {
    headers: { cookie: cookieHeader },
  });
  const aiAdminHtml = await aiAdminPage.text();
  check(
    "AI 配置页可打开",
    aiAdminPage.ok && aiAdminHtml.includes("AI"),
    `HTTP ${aiAdminPage.status}`,
  );

  const workbenchPage = await fetch(`${APP}/agent`, {
    headers: { cookie: cookieHeader },
  });
  const workbenchHtml = await workbenchPage.text();
  check(
    "客服工作台可打开",
    workbenchPage.ok && workbenchHtml.includes("BeeSupport"),
    `HTTP ${workbenchPage.status}`,
  );

  // 通知渠道页内嵌微信扫码登录面板，状态接口沿用 /api/admin/wechat
  const webhooksPage = await fetch(`${APP}${ADMIN_PATH}/webhooks`, {
    headers: {
      cookie: cookieHeader,
      "accept-language": "zh-CN,zh;q=0.9",
    },
  });
  const webhooksHtml = await webhooksPage.text();
  check(
    "通知渠道页含微信扫码登录面板",
    webhooksPage.ok && webhooksHtml.includes("微信扫码登录"),
    `HTTP ${webhooksPage.status}`,
  );

  const wechatApi = await fetch(`${APP}/api/admin/wechat`, {
    headers: { cookie: cookieHeader },
  }).then((response) => response.json());
  check(
    "微信状态接口返回初始状态",
    wechatApi?.state?.status === "stopped" && wechatApi?.state?.qrUrl === null,
    JSON.stringify(wechatApi?.state?.status ?? wechatApi),
  );

  const anonymousWechat = await fetch(`${APP}/api/admin/wechat`);
  check(
    "微信状态接口需要管理员会话",
    anonymousWechat.status === 401,
    `HTTP ${anonymousWechat.status}`,
  );

  // 16. 访客画像：环境指纹 + 页面轨迹 + 历史会话
  const profileLocalKey = `e2e-profile-${Date.now()}`;
  const profileSession = await fetch(`${APP}/api/widget/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      key: autoSite.publicKey,
      localKey: profileLocalKey,
      email: `e2e-profile-${Date.now()}@example.com`,
      name: "E2E 画像访客",
      pageUrl: "https://shop.example.com/checkout",
      pageTitle: "结算页",
      referrer: "https://www.google.com/",
      env: {
        screen: "2560x1440",
        viewport: "1440x900",
        dpr: 2,
        locale: "zh-CN",
        timezone: "Asia/Shanghai",
        device: "桌面端",
        browser: "Chrome 141",
        os: "Windows 10/11",
        connection: "4g / 10Mbps",
        cookies: true,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0",
      },
    }),
  }).then((response) => response.json());

  const profileHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${profileSession.token}`,
  };

  // 模拟 SPA 切页
  await fetch(`${APP}/api/widget/track`, {
    method: "POST",
    headers: profileHeaders,
    body: JSON.stringify({
      pageUrl: "https://shop.example.com/pricing",
      pageTitle: "价格页",
    }),
  });

  const profileConversation = await fetch(`${APP}/api/widget/conversation`, {
    method: "POST",
    headers: profileHeaders,
    body: JSON.stringify({ body: "价格怎么算？", source: "WIDGET" }),
  }).then((response) => response.json());

  const profileHistory = await fetch(
    `${APP}/api/agent/conversations/${profileConversation.conversation?.id}/history`,
    { headers: { cookie: cookieHeader } },
  ).then((response) => response.json());

  check(
    "访客环境指纹已采集",
    profileHistory?.visitor?.meta?.screen === "2560x1440" &&
      profileHistory?.visitor?.meta?.timezone === "Asia/Shanghai" &&
      profileHistory?.visitor?.meta?.browser === "Chrome 141",
    JSON.stringify(profileHistory?.visitor?.meta ?? {}).slice(0, 160),
  );
  check(
    "页面轨迹已累计",
    profileHistory?.visitor?.pageViews >= 2 &&
      String(profileHistory?.visitor?.lastPage ?? "").includes("/pricing") &&
      profileHistory?.visitor?.lastPageTitle === "价格页",
    `pageViews=${profileHistory?.visitor?.pageViews} last=${profileHistory?.visitor?.lastPage}`,
  );
  check(
    "落地页与来源已记录",
    String(profileHistory?.visitor?.landingPage ?? "").includes("/checkout") &&
      String(profileHistory?.visitor?.referrer ?? "").includes("google.com"),
    `${profileHistory?.visitor?.landingPage} / ${profileHistory?.visitor?.referrer}`,
  );
  check(
    "访客历史会话接口可用",
    Array.isArray(profileHistory?.conversations),
    `HTTP 返回 ${Array.isArray(profileHistory?.conversations) ? profileHistory.conversations.length : "n/a"}`,
  );

  const anonymousHistory = await fetch(
    `${APP}/api/agent/conversations/${profileConversation.conversation?.id}/history`,
  );
  check(
    "访客画像接口需要登录",
    anonymousHistory.status === 401,
    `HTTP ${anonymousHistory.status}`,
  );

  const anonymousAdmin = await fetch(`${APP}${ADMIN_PATH}`, {
    redirect: "manual",
  });
  check(
    "未登录访问后台被重定向到登录页",
    anonymousAdmin.status === 307 || anonymousAdmin.status === 302,
    `HTTP ${anonymousAdmin.status}`,
  );

  if (ADMIN_PATH !== "/admin") {
    const blocked = await fetch(`${APP}/admin`, { redirect: "manual" });
    check(
      "默认 /admin 路径被隐藏（返回 404）",
      blocked.status === 404,
      `HTTP ${blocked.status}`,
    );
  }
}

async function main() {
  const resources = createTestResources();
  const errors = [];
  try {
    await run(resources);
  } catch (error) {
    errors.push(error);
  }
  try {
    await resources.close();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length) throw new AggregateError(errors, "E2E 执行或清理失败");
  check("清理测试站点", true);

  const failed = results.filter((item) => !item.ok);
  console.log(
    `\n${failed.length === 0 ? "🎉 全部通过" : `⚠️ ${failed.length} 项失败`}（${results.length - failed.length}/${results.length}）\n`,
  );
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error("\nE2E 运行失败：", error);
  process.exitCode = 1;
});
