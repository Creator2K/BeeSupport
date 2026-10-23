/** Browser regressions against a running app connected to TEST_DATABASE_URL. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import bcrypt from "bcryptjs";
import { useTestDatabase } from "./test-environment.mjs";
import { createTestResources } from "./realtime-test-helpers.mjs";

useTestDatabase();
if (!process.env.TEST_APP_URL)
  throw new Error("请将 TEST_APP_URL 指向连接独立测试数据库的应用实例。");
const APP = process.env.TEST_APP_URL.replace(/\/$/, "");
const ADMIN = (process.env.ADMIN_PATH ?? "/admin").replace(/\/$/, "");
const stamp = randomUUID().replaceAll("-", "");
const artifacts =
  process.env.FRONTEND_ARTIFACT_DIR ?? `/tmp/beesupport-frontend-${stamp}`;
const resources = createTestResources();
const results = [];

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  resources.add(() => prisma.$disconnect());
  await mkdir(artifacts, { recursive: true });
  const launch = { headless: true };
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH)
    launch.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  const browser = await chromium.launch(launch);
  resources.add(() => browser.close());
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  });
  const login = await ctx.request.post(`${APP}/api/auth/login`, {
    data: {
      email: process.env.SEED_ADMIN_EMAIL ?? "admin@beesupport.local",
      password: process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!",
    },
  });
  assert.equal(login.status(), 200, "请先在独立测试数据库初始化管理员账号");
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  const fixtures = {};
  for (const label of ["A", "B"]) {
    const site = await prisma.site.create({
      data: {
        name: `UI ${label}`,
        slug: `ui-${label.toLowerCase()}-${stamp}`,
        publicKey: `ui-${label}-${stamp}`,
        autoAssign: false,
        requireEmail: label === "A",
      },
    });
    resources.add(() => prisma.site.deleteMany({ where: { id: site.id } }));
    const session = await ctx.request
      .post(`${APP}/api/widget/session`, {
        data: {
          key: site.publicKey,
          localKey: `ui-${label}-${stamp}`,
          email: `${label.toLowerCase()}@ui.example`,
          name: `UI ${label} 访客`,
        },
      })
      .then((r) => r.json());
    assert.ok(session.token);
    const conversation = await ctx.request
      .post(`${APP}/api/widget/conversation`, {
        headers: { authorization: `Bearer ${session.token}` },
        data: { body: `UI ${label} initial message` },
      })
      .then((r) => r.json());
    fixtures[label] = {
      site,
      token: session.token,
      id: conversation.conversation.id,
    };
  }
  await prisma.message.createMany({
    data: Array.from({ length: 230 }, (_, index) => ({
      conversationId: fixtures.A.id,
      sender: "VISITOR",
      body: `UI 历史消息 ${index}：检查历史阅读位置与分页。`,
      createdAt: new Date(Date.now() - 250000 + index * 1000),
    })),
  });
  await prisma.cannedResponse.create({
    data: {
      title: `A 专属 ${stamp}`,
      content: "只适用于 UI A",
      siteId: fixtures.A.site.id,
      shared: true,
    },
  });
  const globalReply = await prisma.cannedResponse.create({
    data: {
      title: `全局话术 ${stamp}`,
      content: "适用于所有站点",
      shared: true,
    },
  });
  resources.add(() =>
    prisma.cannedResponse.deleteMany({ where: { id: globalReply.id } }),
  );

  async function test(name, operation) {
    try {
      await operation();
      results.push({ name, ok: true });
      console.log(`✅ ${name}`);
    } catch (error) {
      results.push({ name, ok: false, error: error.message });
      console.error(`❌ ${name}: ${error.message}`);
      await page
        .screenshot({
          path: `${artifacts}/failure-${results.length}.png`,
          fullPage: true,
        })
        .catch(() => undefined);
    }
  }
  async function chat(id) {
    await page.goto(`${APP}/agent?c=${id}`);
    await page.locator("main textarea").waitFor();
    await page.getByText("实时连接正常", { exact: true }).waitFor();
    await page.waitForTimeout(350);
  }
  async function visitorMessage(body) {
    const r = await ctx.request.post(`${APP}/api/widget/conversation`, {
      headers: { authorization: `Bearer ${fixtures.A.token}` },
      data: { conversationId: fixtures.A.id, body },
    });
    assert.ok(r.ok());
    await page
      .locator("main")
      .getByText(body, { exact: true })
      .waitFor({ state: "attached" });
    await page.waitForTimeout(350);
  }

  await test("AI 延迟响应不会串入另一会话，切换后仍能生成新建议", async () => {
    const patternA = `**/api/agent/conversations/${fixtures.A.id}/suggest`;
    const patternB = `**/api/agent/conversations/${fixtures.B.id}/suggest`;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await page.route(patternA, async (route) => {
      await gate;
      await route
        .fulfill({ json: { text: "仅属于 A 的建议", model: "mock" } })
        .catch(() => undefined);
    });
    await page.route(patternB, (route) =>
      route.fulfill({ json: { text: "仅属于 B 的建议", model: "mock" } }),
    );
    try {
      await chat(fixtures.A.id);
      const requested = page.waitForRequest((r) =>
        r.url().endsWith(`/${fixtures.A.id}/suggest`),
      );
      await page.getByRole("button", { name: "AI 建议", exact: true }).click();
      await requested;
      await page.getByRole("button", { name: /UI B 访客/ }).click();
      await page.locator("main textarea").fill("B 原有草稿");
      release();
      await page.waitForTimeout(500);
      assert.equal(
        await page.getByText("仅属于 A 的建议", { exact: true }).count(),
        0,
      );
      assert.equal(
        await page.locator("main textarea").inputValue(),
        "B 原有草稿",
      );
      await page.getByRole("button", { name: "AI 建议", exact: true }).click();
      await page.getByText("仅属于 B 的建议", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "填入输入框", exact: true })
        .click();
      assert.equal(
        await page.locator("main textarea").inputValue(),
        "B 原有草稿\n仅属于 B 的建议",
      );
    } finally {
      release();
      await page.unroute(patternA);
      await page.unroute(patternB);
    }
  });
  await test("访客新消息保留未保存的备注和主题", async () => {
    await chat(fixtures.A.id);
    await page.getByPlaceholder("仅客服可见，不会发给访客").fill("备注编辑中");
    await page.locator("#conversation-subject").fill("主题编辑中");
    await visitorMessage("UI 新消息不能覆盖编辑草稿");
    assert.equal(
      await page.getByPlaceholder("仅客服可见，不会发给访客").inputValue(),
      "备注编辑中",
    );
    assert.equal(
      await page.locator("#conversation-subject").inputValue(),
      "主题编辑中",
    );
  });
  await test("备注保存失败不提示成功，并允许重新保存", async () => {
    await chat(fixtures.A.id);
    const pattern = `**/api/agent/conversations/${fixtures.A.id}`;
    await page.route(pattern, (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({ status: 500, json: { error: "模拟保存失败" } })
        : route.continue(),
    );
    try {
      await page
        .getByPlaceholder("仅客服可见，不会发给访客")
        .fill("需要重试的备注");
      await page.getByRole("button", { name: "添加备注", exact: true }).click();
      await page.getByText("模拟保存失败", { exact: true }).waitFor();
      assert.equal(
        await page.getByText("备注已保存", { exact: true }).count(),
        0,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "添加备注", exact: true })
          .isEnabled(),
        true,
      );
    } finally {
      await page.unroute(pattern);
    }
    await page.getByRole("button", { name: "添加备注", exact: true }).click();
    await page.getByText("备注已保存", { exact: true }).waitFor();
    assert.equal(
      (await prisma.conversation.findUnique({ where: { id: fixtures.A.id } }))
        .note,
      "需要重试的备注",
    );
  });
  await test("工作台阅读历史时保留位置，并可跳转到新消息", async () => {
    await chat(fixtures.A.id);
    const scroll = page.locator("main > .overflow-y-auto");
    await scroll.evaluate((e) => {
      e.scrollTop = 150;
    });
    await page.waitForTimeout(100);
    await visitorMessage("UI 保持历史阅读位置");
    assert.ok(Math.abs((await scroll.evaluate((e) => e.scrollTop)) - 150) < 30);
    await page
      .getByRole("button", { name: "有新消息，点击查看", exact: true })
      .click();
    assert.ok(
      (await scroll.evaluate(
        (e) => e.scrollHeight - e.scrollTop - e.clientHeight,
      )) < 2,
    );
  });
  await test("加载更早消息保留原有阅读位置", async () => {
    await chat(fixtures.A.id);
    const scroll = page.locator("main > .overflow-y-auto");
    await scroll.evaluate((e) => {
      e.scrollTop = 0;
    });
    const before = await scroll.evaluate((e) => e.scrollHeight);
    await page
      .getByRole("button", { name: "加载更早消息", exact: true })
      .click();
    await page.waitForTimeout(500);
    const after = await scroll.evaluate((e) => ({
      top: e.scrollTop,
      height: e.scrollHeight,
    }));
    assert.ok(after.height > before);
    assert.ok(Math.abs(after.top - (after.height - before)) < 5);
  });
  await test("话术只展示全局及当前站点内容", async () => {
    await chat(fixtures.B.id);
    await page.getByRole("button", { name: "快捷话术", exact: true }).click();
    assert.equal(
      await page.getByText(`A 专属 ${stamp}`, { exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByText(`全局话术 ${stamp}`, { exact: true }).isVisible(),
      true,
    );
  });
  await test("在线状态请求失败保留服务端状态", async () => {
    await chat(fixtures.A.id);
    const before = await ctx.request
      .get(`${APP}/api/auth/me`)
      .then((r) => r.json());
    const labels = { ONLINE: "在线", AWAY: "离开", OFFLINE: "离线" };
    const target = before.user.status === "AWAY" ? "在线" : "离开";
    await page.route("**/api/agent/status", (route) =>
      route.fulfill({ status: 500, json: { error: "模拟状态失败" } }),
    );
    try {
      await page.locator('header button[aria-haspopup="menu"]').first().click();
      await page.getByRole("menuitem", { name: target, exact: true }).click();
      await page.getByText("操作失败，请重试", { exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("button", {
            name: labels[before.user.status],
            exact: true,
          })
          .isEnabled(),
        true,
      );
    } finally {
      await page.unroute("**/api/agent/status");
    }
  });
  await test("后台保存请求中断后恢复按钮并显示错误", async () => {
    await page.goto(`${APP}${ADMIN}/settings`);
    const pattern = `**${ADMIN}/settings`;
    await page.route(pattern, (route) =>
      route.request().method() === "POST"
        ? route.abort("failed")
        : route.continue(),
    );
    try {
      const form = page
        .locator("form")
        .filter({ has: page.locator("#profile-name") });
      await form.locator('button[type="submit"]').click();
      await page.getByText("操作失败，请重试", { exact: true }).waitFor();
      assert.equal(
        await form.locator('button[type="submit"]').isEnabled(),
        true,
      );
    } finally {
      await page.unroute(pattern);
    }
  });
  await test("关闭邮箱必填后可直接开始聊天", async () => {
    await page.goto(`${APP}/widget?key=${fixtures.B.site.publicKey}`);
    await page.locator("#visitor-email").waitFor();
    assert.equal(
      await page.locator("#visitor-email").getAttribute("required"),
      null,
    );
    await page.locator('form button[type="submit"]').click();
    await page.locator("textarea").waitFor();
  });
  await test("访客阅读历史时新消息不会强制滚动", async () => {
    await page.goto(`${APP}/widget?key=${fixtures.A.site.publicKey}`);
    await page.locator("#visitor-email").waitFor();
    await page.evaluate(
      ({ key, token }) =>
        localStorage.setItem(
          `beesupport:visitor:${key}`,
          JSON.stringify({ token, email: "a@ui.example", name: "UI A 访客" }),
        ),
      { key: fixtures.A.site.publicKey, token: fixtures.A.token },
    );
    await page.reload();
    await page.locator("textarea").waitFor();
    const scroll = page.locator(".overflow-y-auto").first();
    await scroll.evaluate((e) => {
      e.scrollTop = 150;
    });
    await page.waitForTimeout(300);
    const r = await ctx.request.post(
      `${APP}/api/agent/conversations/${fixtures.A.id}/messages`,
      { data: { body: "UI 客服新消息不打断访客阅读" } },
    );
    assert.ok(r.ok());
    await page
      .getByText("UI 客服新消息不打断访客阅读", { exact: true })
      .waitFor();
    assert.ok(Math.abs((await scroll.evaluate((e) => e.scrollTop)) - 150) < 30);
  });
  await test("手机 AI 配置页没有横向溢出", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${APP}${ADMIN}/ai`);
    await page.getByRole("button", { name: "获取模型", exact: true }).waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `${artifacts}/ai-mobile.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  await test("普通客服能打开并修改自己的账号资料", async () => {
    const user = await prisma.user.create({
      data: {
        name: "UI 客服",
        email: `ui-${stamp}@example.com`,
        role: "AGENT",
        passwordHash: await bcrypt.hash("UiRegression123!", 10),
      },
    });
    resources.add(() => prisma.user.deleteMany({ where: { id: user.id } }));
    const agent = await browser.newContext({ locale: "zh-CN" });
    try {
      await agent.request.post(`${APP}/api/auth/login`, {
        data: { email: user.email, password: "UiRegression123!" },
      });
      const p = await agent.newPage();
      await p.goto(`${APP}/agent`);
      await p.locator('header button[aria-haspopup="menu"]').first().click();
      await p.getByRole("menuitem", { name: "我的账号", exact: true }).click();
      await p.locator("#profile-name").waitFor();
      assert.equal(new URL(p.url()).pathname, "/agent/settings");
      await p.locator("#profile-name").fill("UI 客服已修改");
      await p
        .locator("form")
        .filter({ has: p.locator("#profile-name") })
        .locator('button[type="submit"]')
        .click();
      await p.getByText("已保存", { exact: true }).waitFor();
      assert.equal(
        (await prisma.user.findUnique({ where: { id: user.id } })).name,
        "UI 客服已修改",
      );
    } finally {
      await agent.close();
    }
  });
  await test("管理员连接后新建站点仍立即收到消息，伪造 IP 头不会进入访客资料", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await chat(fixtures.A.id);
    const site = await prisma.site.create({
      data: {
        name: "UI C",
        slug: `ui-c-${stamp}`,
        publicKey: `ui-c-${stamp}`,
        autoAssign: false,
      },
    });
    resources.add(() => prisma.site.deleteMany({ where: { id: site.id } }));
    const response = await ctx.request.post(`${APP}/api/widget/session`, {
      headers: {
        "x-forwarded-for": "203.0.113.99",
        "x-beesupport-client-ip": "203.0.113.98",
      },
      data: {
        key: site.publicKey,
        localKey: `ui-c-${stamp}`,
        email: "c@ui.example",
        name: "UI C 访客",
      },
    });
    assert.ok(response.ok());
    const session = await response.json();
    const visitor = await prisma.visitor.findUnique({
      where: { id: session.visitor.id },
    });
    assert.notEqual(visitor.meta.ip, "203.0.113.99");
    assert.notEqual(visitor.meta.ip, "203.0.113.98");
    const sent = await ctx.request.post(`${APP}/api/widget/conversation`, {
      headers: { authorization: `Bearer ${session.token}` },
      data: { body: "new site live event" },
    });
    assert.ok(sent.ok());
    await page
      .getByRole("button", { name: /UI C 访客/ })
      .waitFor({ timeout: 5000 });
  });
  await test("后台详情可以翻过 200 条限制，并可在加载失败后重试", async () => {
    await page.goto(`${APP}${ADMIN}/conversations?query=a%40ui.example`);
    const pattern = `**/api/agent/conversations/${fixtures.A.id}`;
    await page.route(pattern, (route) => route.abort());
    await page.getByRole("row").filter({ hasText: "UI A 访客" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "重试", exact: true }).waitFor();
    await page.unroute(pattern);
    await dialog.getByRole("button", { name: "重试", exact: true }).click();
    await dialog.getByRole("button", { name: "加载更早消息" }).click();
    await dialog
      .getByText("UI 历史消息 0：检查历史阅读位置与分页。", { exact: true })
      .waitFor({ state: "attached" });
    assert.equal(
      await dialog.getByRole("button", { name: "加载更早消息" }).count(),
      0,
    );
  });
  await test("接入失败有提示、解除禁用且没有未处理异常", async () => {
    await prisma.conversation.update({
      where: { id: fixtures.B.id },
      data: { status: "PENDING", assignedAgentId: null },
    });
    await chat(fixtures.B.id);
    const pattern = `**/api/agent/conversations/${fixtures.B.id}/actions`;
    await page.route(pattern, (route) =>
      route.request().postDataJSON()?.action === "claim"
        ? route.abort()
        : route.continue(),
    );
    try {
      const button = page.getByRole("button", {
        name: "接入会话",
        exact: true,
      });
      await button.click();
      await page.getByText("操作失败，请重试", { exact: true }).waitFor();
      assert.equal(await button.isDisabled(), false);
    } finally {
      await page.unroute(pattern);
    }
  });
  await test("粘贴图片上传失败不会出现发送成功提示", async () => {
    await chat(fixtures.A.id);
    await page.route("**/api/agent/upload", (route) => route.abort());
    try {
      await page.locator("main textarea").evaluate((element) => {
        const data = new DataTransfer();
        data.items.add(
          new File([new Uint8Array([137, 80, 78, 71])], "test.png", {
            type: "image/png",
          }),
        );
        element.dispatchEvent(
          new ClipboardEvent("paste", { bubbles: true, clipboardData: data }),
        );
      });
      await page.getByText("文件上传失败", { exact: true }).waitFor();
      assert.equal(
        await page.getByText("图片已发送", { exact: true }).count(),
        0,
      );
    } finally {
      await page.unroute("**/api/agent/upload");
    }
  });
  await test("HTTP 复制兼容与手动复制兜底", async () => {
    await page.goto(`${APP}${ADMIN}/sites`);
    // LAN HTTP exercises the native fallback; HTTPS also exercises permission-denial fallback below.
    await page
      .getByRole("button", { name: "复制", exact: true })
      .first()
      .click();
    await page.getByText("已复制", { exact: true }).waitFor();
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      });
      document.execCommand = () => false;
    });
    await page
      .getByRole("button", { name: "复制", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByText("自动复制不可用，请选中文本后复制。", { exact: true })
      .waitFor();
    assert.ok((await dialog.locator("textarea").inputValue()).length > 0);
  });
  await test("编辑站点保留一天多个工作时段", async () => {
    const days = {
      1: [
        ["09:00", "12:00"],
        ["14:00", "18:00"],
      ],
    };
    await prisma.site.update({
      where: { id: fixtures.A.site.id },
      data: { workHours: { enabled: true, timezone: "Asia/Shanghai", days } },
    });
    await page.goto(`${APP}${ADMIN}/sites`);
    await page
      .getByRole("row")
      .filter({ hasText: "UI A" })
      .locator('button[aria-haspopup="menu"]')
      .click();
    await page.getByRole("menuitem", { name: "编辑", exact: true }).click();
    const dialog = page.getByRole("dialog");
    assert.equal(await dialog.locator('input[type="time"]').count(), 4);
    await dialog.locator("#site-desc").fill("Range round trip");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const saved = await prisma.site.findUnique({
      where: { id: fixtures.A.site.id },
    });
    assert.deepEqual(saved.workHours.days, days);
  });
  await test("桌面与手机控件通过可访问名称和标签检查", async () => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of [
        `/agent?c=${fixtures.A.id}`,
        `${ADMIN}/settings`,
        `${ADMIN}/ai`,
        `${ADMIN}/webhooks`,
        "/agent/settings",
      ]) {
        await page.goto(APP + path);
        await page.waitForTimeout(400);
        const audit = await new AxeBuilder({ page })
          .withRules([
            "button-name",
            "label",
            "select-name",
            "aria-input-field-name",
            "aria-toggle-field-name",
          ])
          .analyze();
        assert.deepEqual(
          audit.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => n.target),
          })),
          [],
          `${width}px ${path}`,
        );
      }
    }
    assert.deepEqual(browserErrors, []);
  });
  await writeFile(
    `${artifacts}/results.json`,
    JSON.stringify(results, null, 2),
  );
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `\n前端浏览器回归：${results.length - failed}/${results.length}；证据目录：${artifacts}`,
  );
  if (failed) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  try {
    await resources.close();
  } catch (error) {
    console.error("前端测试资源清理失败：", error);
    process.exitCode = 1;
  }
}
