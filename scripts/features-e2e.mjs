/** Real browser/API regressions for images, emoji, previews, profiles and risk controls. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { io } from "socket.io-client";
import { useTestDatabase } from "./test-environment.mjs";
import { connectSocket } from "./realtime-test-helpers.mjs";

useTestDatabase();
if (!process.env.TEST_APP_URL)
  throw new Error("需要连接独立测试数据库的 TEST_APP_URL");
const APP = process.env.TEST_APP_URL.replace(/\/$/, "");
const ADMIN = process.env.ADMIN_PATH || "/admin";
const stamp = randomUUID().replaceAll("-", "");
const artifacts = `${process.env.FRONTEND_ARTIFACT_DIR || "/tmp/beesupport-features"}/features`;
const results = [];
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const siteIds = [];
let browser;
let socket;
let page;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1xkAAAAASUVORK5CYII=",
  "base64",
);
async function until(check, message = "condition", timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timeout: ${message}`);
}
// 绕过后台直接改库不会清掉应用里的风控规则缓存，要等它过期。
// 和应用读同一个变量：留空或写错按默认 5 秒算
const ruleCacheMs = Number(
  process.env.RISK_RULE_CACHE_TTL_MS?.trim() || 5000,
);
const ruleCacheExpired = () =>
  new Promise((resolve) =>
    setTimeout(
      resolve,
      (Number.isFinite(ruleCacheMs) && ruleCacheMs >= 0
        ? Math.min(ruleCacheMs, 60000)
        : 5000) + 500,
    ),
  );
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✅ ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.stack });
    console.error(`❌ ${name}: ${error.stack}`);
    await page
      ?.screenshot({
        path: `${artifacts}/failure-${results.length}.png`,
        fullPage: true,
      })
      .catch(() => {});
  }
}

try {
  await mkdir(artifacts, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
  });
  const admin = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1440, height: 1000 },
  });
  const visitorContext = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 390, height: 844 },
  });
  assert.equal(
    (
      await admin.request.post(`${APP}/api/auth/login`, {
        data: {
          email: process.env.SEED_ADMIN_EMAIL || "admin@beesupport.local",
          password: process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!",
        },
      })
    ).status(),
    200,
  );
  page = await admin.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (e) =>
    errors.push({ message: e.message, url: page.url(), stack: e.stack }),
  );
  const site = await prisma.site.create({
    data: {
      name: `Feature ${stamp.slice(0, 8)}`,
      slug: `f-${stamp}`,
      publicKey: `feature-${stamp}`,
      requireEmail: false,
      autoAssign: false,
    },
  });
  siteIds.push(site.id);
  const other = await prisma.site.create({
    data: {
      name: "Other feature site",
      slug: `o-${stamp}`,
      publicKey: `other-${stamp}`,
      requireEmail: false,
      autoAssign: false,
    },
  });
  siteIds.push(other.id);
  const sessionResponse = await visitorContext.request.post(
    `${APP}/api/widget/session`,
    {
      data: {
        key: site.publicKey,
        localKey: `feature-${stamp}`,
        name: "Feature Visitor",
        email: "feature@example.test",
        env: { browser: "Chrome", os: "Linux", timezone: "Asia/Shanghai" },
        pageUrl: "https://example.test/pricing",
      },
    },
  );
  assert.equal(sessionResponse.status(), 200);
  const session = await sessionResponse.json();
  const headers = { authorization: `Bearer ${session.token}` };
  const messageResponse = await visitorContext.request.post(
    `${APP}/api/widget/conversation`,
    { headers, data: { body: "Feature initial message" } },
  );
  assert.equal(messageResponse.status(), 200);
  const { conversation } = await messageResponse.json();
  const conversationId = conversation.id;
  const upload = await visitorContext.request.post(`${APP}/api/widget/upload`, {
    headers,
    multipart: {
      file: { name: "feature.png", mimeType: "image/png", buffer: png },
    },
  });
  assert.equal(upload.status(), 200);
  const { attachment } = await upload.json();
  assert.equal(
    (
      await visitorContext.request.post(`${APP}/api/widget/conversation`, {
        headers,
        data: { conversationId, body: "", attachmentIds: [attachment.id] },
      })
    ).status(),
    200,
  );
  const visitorId = session.visitor.id;
  const ip = (await prisma.visitor.findUnique({ where: { id: visitorId } }))
    .meta.ip;

  await test("客服图片在当前页面放大缩放，Escape 关闭，不触发下载或新标签", async () => {
    let downloads = 0;
    let popups = 0;
    const onDownload = () => downloads++;
    const onPopup = () => popups++;
    page.on("download", onDownload);
    page.on("popup", onPopup);
    try {
      await page.goto(`${APP}/agent?c=${conversationId}`);
      await page
        .getByRole("button", { name: "放大查看图片: feature.png", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("img", { name: "feature.png" }).waitFor();
      await until(
        () =>
          dialog
            .locator("img")
            .evaluate((img) => img.complete && img.naturalWidth > 0),
        "image loaded",
      );
      await dialog.getByRole("button", { name: "放大", exact: true }).click();
      await dialog.getByText("150%", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      assert.equal(downloads, 0);
      assert.equal(popups, 0);
    } finally {
      page.off("download", onDownload);
      page.off("popup", onPopup);
    }
  });
  await test("客服表情插入光标处并作为普通消息发送", async () => {
    const input = page.locator("main textarea");
    await input.fill("AB");
    await input.evaluate((el) => {
      el.focus();
      el.setSelectionRange(1, 1);
    });
    await page.getByRole("button", { name: "表情", exact: true }).click();
    await page
      .getByRole("button", { name: "插入表情 😊", exact: true })
      .click();
    assert.equal(await input.inputValue(), "A😊B");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await until(
      async () =>
        Boolean(
          await prisma.message.findFirst({
            where: { conversationId, body: "A😊B", sender: "AGENT" },
          }),
        ),
      "emoji message persisted",
    );
  });
  await test("示例网页实际嵌入脚本，PC 和手机布局正常，限制域名也可用授权预览", async () => {
    await prisma.site.update({
      where: { id: site.id },
      data: { allowedOrigins: ["only.example.invalid"] },
    });
    await page.goto(`${APP}${ADMIN}/sites`);
    await page
      .getByRole("row")
      .filter({ hasText: site.name })
      .locator('button[aria-haspopup="menu"]')
      .click();
    const link = page.locator(`a[href="/preview?key=${site.publicKey}"]`);
    await link.waitFor();
    assert.equal(await link.count(), 1);
    await page.goto(`${APP}/preview?key=${site.publicKey}`);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole("heading", { name: /好产品/ }).waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
        true,
      );
      await page
        .locator('script[src^="/widget.js?"]')
        .waitFor({ state: "attached" });
      await until(
        () => page.evaluate(() => Boolean(window.BeeSupport)),
        "actual widget loader",
      );
      await page.evaluate(() => window.BeeSupport.open());
      const frame = page.frameLocator('iframe[title="在线客服"]');
      await frame
        .getByRole("button", { name: "开始对话", exact: true })
        .waitFor();
      await until(async () => {
        const rect = await page
          .locator('iframe[title="在线客服"]')
          .boundingBox();
        return (
          rect.width <= width + 1 &&
          (width < 480 ? rect.width >= width - 2 : rect.width <= 410)
        );
      }, "embed dimensions after opening animation");
      await frame.getByRole("button", { name: "关闭", exact: true }).click();
      await page.screenshot({
        path: `${artifacts}/preview-${width}.png`,
        fullPage: true,
      });
    }
    const anonymousPreview = await visitorContext.request.get(
      `${APP}/preview?key=${site.publicKey}`,
      { maxRedirects: 0 },
    );
    assert.equal(anonymousPreview.status(), 307);
    assert.equal(
      (
        await visitorContext.request.get(`${APP}/widget?key=${site.publicKey}`)
      ).status(),
      404,
    );
    await prisma.site.update({
      where: { id: site.id },
      data: { allowedOrigins: [] },
    });
  });
  await test("访客图片使用令牌加载，在嵌入网页全屏放大，关闭后恢复窗口；支持表情", async () => {
    await prisma.site.update({
      where: { id: site.id },
      data: { allowedOrigins: [] },
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${APP}/preview?key=${site.publicKey}`);
    await page.evaluate(
      ({ key, token }) =>
        localStorage.setItem(
          `beesupport:visitor:${key}`,
          JSON.stringify({
            token,
            email: "feature@example.test",
            name: "Feature Visitor",
          }),
        ),
      { key: site.publicKey, token: session.token },
    );
    await page.reload();
    await until(() => page.evaluate(() => Boolean(window.BeeSupport)));
    await page.evaluate(() => window.BeeSupport.open());
    const frame = page.frameLocator('iframe[title="在线客服"]');
    await frame
      .getByRole("button", { name: "放大查看图片: feature.png", exact: true })
      .click();
    await frame.getByRole("dialog").waitFor();
    await until(
      async () =>
        (await page.locator('iframe[title="在线客服"]').boundingBox()).width >
        1400,
      "iframe expanded",
    );
    await page.screenshot({ path: `${artifacts}/embedded-image.png` });
    await frame.getByRole("button", { name: "Close", exact: true }).click();
    await until(
      async () =>
        (await page.locator('iframe[title="在线客服"]').boundingBox()).width <
        410,
      "iframe restored",
    );
    const input = frame.locator("textarea").last();
    await input.fill("访客");
    await frame.getByRole("button", { name: "表情", exact: true }).click();
    await frame
      .getByRole("button", { name: "插入表情 👍", exact: true })
      .click();
    assert.equal(await input.inputValue(), "访客👍");
    const independent = await visitorContext.newPage();
    await independent.addInitScript(
      ({ key, token }) =>
        localStorage.setItem(
          `beesupport:visitor:${key}`,
          JSON.stringify({
            token,
            email: "feature@example.test",
            name: "Feature Visitor",
          }),
        ),
      { key: site.publicKey, token: session.token },
    );
    await independent.goto(`${APP}/widget?key=${site.publicKey}`);
    await independent
      .getByRole("button", { name: "放大查看图片: feature.png", exact: true })
      .click();
    await until(
      () =>
        independent
          .getByRole("dialog")
          .locator("img")
          .evaluate((img) => img.complete && img.naturalWidth > 0),
      "bearer protected image loaded",
    );
    await independent.close();
  });
  await test("画像编辑持久保存，设备与访问历史可见，访客接口不泄露内部备注", async () => {
    await page.goto(
      `${APP}${ADMIN}/visitors/list?query=feature%40example.test`,
    );
    await page.getByRole("link", { name: "查看画像", exact: true }).click();
    await page
      .getByText("https://example.test/pricing", { exact: true })
      .first()
      .waitFor();
    await page.locator("#profile-tags").fill("意向客户, 需要回访");
    await page.locator("#profile-note").fill("内部画像备注，不能向访客公开");
    await page.getByRole("button", { name: "保存画像", exact: true }).click();
    await until(
      async () =>
        (await prisma.visitor.findUnique({ where: { id: visitorId } }))
          .profileTags.length === 2,
      "profile persisted",
    );
    await page.reload();
    assert.equal(
      await page.locator("#profile-note").inputValue(),
      "内部画像备注，不能向访客公开",
    );
    const response = await visitorContext.request.get(
      `${APP}/api/widget/conversation`,
      { headers },
    );
    const body = await response.text();
    assert.equal(response.status(), 200);
    assert.ok(!body.includes("内部画像备注"));
    assert.ok(!body.includes("profileNote"));
    assert.equal(
      (
        await visitorContext.request.get(
          `${APP}${ADMIN}/visitors/${visitorId}`,
          { maxRedirects: 0 },
        )
      ).status(),
      307,
    );
  });
  async function addRule(kind, values, targetSite = site.id) {
    await page.goto(`${APP}${ADMIN}/risk`);
    await page.getByRole("button", { name: "添加规则", exact: true }).click();
    await page.locator("#risk-kind").selectOption(kind);
    await page.locator("#risk-site").selectOption(targetSite || "");
    await page.locator("#risk-values").fill(values);
    await page.getByRole("button", { name: "保存规则", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  }
  await test("违禁词按站点拦截，兼容全角和隐形字符；过期或停用规则放行并记录拦截", async () => {
    await addRule("WORD", "敏感测试词\nＢＡＤＷＯＲＤ");
    for (const body of ["敏 感\u200b测试词", "badword"]) {
      const response = await visitorContext.request.post(
        `${APP}/api/widget/conversation`,
        { headers, data: { conversationId, body } },
      );
      assert.equal(response.status(), 403);
      assert.equal(
        await prisma.message.count({ where: { conversationId, body } }),
        0,
      );
    }
    const otherSession = await visitorContext.request
      .post(`${APP}/api/widget/session`, {
        data: { key: other.publicKey, localKey: `other-${stamp}` },
      })
      .then((r) => r.json());
    assert.equal(
      (
        await visitorContext.request.post(`${APP}/api/widget/conversation`, {
          headers: { authorization: `Bearer ${otherSession.token}` },
          data: { body: "敏感测试词" },
        })
      ).status(),
      200,
    );
    const word = await prisma.riskRule.findFirst({
      where: { siteId: site.id, value: "敏感测试词" },
    });
    await prisma.riskRule.update({
      where: { id: word.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await ruleCacheExpired();
    assert.equal(
      (
        await visitorContext.request.post(`${APP}/api/widget/conversation`, {
          headers,
          data: { conversationId, body: "敏感测试词" },
        })
      ).status(),
      200,
    );
    await page.reload();
    const row = page
      .getByRole("row")
      .filter({ hasText: "badword" })
      .filter({ has: page.getByRole("button", { name: "停用", exact: true }) });
    await row.getByRole("button", { name: "停用", exact: true }).click();
    await until(
      async () =>
        !(
          await prisma.riskRule.findFirst({
            where: { siteId: site.id, value: "badword" },
          })
        ).active,
    );
    assert.equal(
      (
        await visitorContext.request.post(`${APP}/api/widget/conversation`, {
          headers,
          data: { conversationId, body: "badword" },
        })
      ).status(),
      200,
    );
    assert.ok(
      (await prisma.riskEvent.count({
        where: { siteId: site.id, kind: "WORD" },
      })) >= 2,
    );
    await page
      .getByRole("row")
      .filter({ hasText: "badword" })
      .filter({ has: page.getByRole("button", { name: "启用", exact: true }) })
      .getByRole("button", { name: "编辑", exact: true })
      .click();
    await page.locator("#risk-note").fill("编辑停用规则不应自动启用");
    await page.getByRole("button", { name: "保存规则", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(
      (
        await prisma.riskRule.findFirst({
          where: { siteId: site.id, value: "badword" },
        })
      ).active,
      false,
    );
    const globalWord = `全局${stamp}`;
    await addRule("WORD", globalWord, "");
    const globalRule = await prisma.riskRule.findFirst({
      where: { siteId: null, value: globalWord },
    });
    try {
      for (const token of [session.token, otherSession.token]) {
        const denied = await visitorContext.request.post(
          `${APP}/api/widget/conversation`,
          {
            headers: { authorization: `Bearer ${token}` },
            data: { body: globalWord },
          },
        );
        assert.equal(denied.status(), 403);
      }
      await page
        .getByRole("row")
        .filter({ hasText: globalWord })
        .filter({
          has: page.getByRole("button", { name: "删除", exact: true }),
        })
        .getByRole("button", { name: "删除", exact: true })
        .click();
      await page.getByRole("button", { name: "确认删除", exact: true }).click();
      await until(
        async () =>
          !(await prisma.riskRule.findUnique({ where: { id: globalRule.id } })),
        "rule deleted through UI",
      );
    } finally {
      await prisma.riskRule.deleteMany({ where: { id: globalRule.id } });
    }
  });
  await test("IP 封禁使既有 HTTP/Socket 会话失效，伪造转发头不能绕过，停用后恢复", async () => {
    socket = await connectSocket(io, APP, { auth: { token: session.token } });
    await addRule("IP", ip);
    await until(
      () => !socket.connected,
      "existing visitor socket disconnected",
    );
    for (const path of [
      "/api/widget/conversation",
      `/api/files/${attachment.id}`,
    ])
      assert.equal(
        (
          await visitorContext.request.get(`${APP}${path}`, {
            headers: {
              ...headers,
              "x-forwarded-for": "203.0.113.88",
              "x-beesupport-client-ip": "203.0.113.88",
            },
          })
        ).status(),
        403,
      );
    for (const path of [
      "/api/widget/ping",
      "/api/widget/track",
      "/api/widget/read",
      "/api/widget/rate",
      "/api/widget/upload",
    ])
      assert.equal(
        (
          await visitorContext.request.post(`${APP}${path}`, {
            headers,
            data: {},
          })
        ).status(),
        403,
      );
    assert.equal(
      (
        await visitorContext.request.post(`${APP}/api/widget/session`, {
          data: { key: site.publicKey, localKey: `new-${stamp}` },
        })
      ).status(),
      403,
    );
    await assert.rejects(
      connectSocket(io, APP, { auth: { token: session.token } }),
      /Unauthorized/,
    );
    assert.equal(
      (await admin.request.get(`${APP}${ADMIN}/risk`)).status(),
      200,
    );
    const row = page
      .getByRole("row")
      .filter({ hasText: ip })
      .filter({ has: page.getByRole("button", { name: "停用", exact: true }) });
    await row.getByRole("button", { name: "停用", exact: true }).click();
    await until(
      async () =>
        !(
          await prisma.riskRule.findFirst({
            where: { siteId: site.id, kind: "IP", value: ip },
          })
        ).active,
    );
    assert.equal(
      (
        await visitorContext.request.get(`${APP}/api/widget/conversation`, {
          headers,
        })
      ).status(),
      200,
    );
    socket.close();
    socket = null;
  });
  await test("封禁访客身份立即断开连接，解除封禁恢复访问，手机后台无横向溢出", async () => {
    socket = await connectSocket(io, APP, { auth: { token: session.token } });
    await page.goto(`${APP}${ADMIN}/visitors/${visitorId}`);
    await page.locator("#profile-blocked").check();
    await page.getByRole("button", { name: "保存画像", exact: true }).click();
    await until(() => !socket.connected, "blocked visitor disconnected");
    assert.equal(
      (
        await visitorContext.request.get(`${APP}/api/widget/conversation`, {
          headers,
        })
      ).status(),
      401,
    );
    await page.locator("#profile-blocked").uncheck();
    await page.getByRole("button", { name: "保存画像", exact: true }).click();
    await until(
      async () =>
        !(await prisma.visitor.findUnique({ where: { id: visitorId } }))
          .blocked,
    );
    assert.equal(
      (
        await visitorContext.request.get(`${APP}/api/widget/conversation`, {
          headers,
        })
      ).status(),
      200,
    );
    socket.close();
    socket = null;
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of [
        `${ADMIN}/visitors`,
        `${ADMIN}/visitors/${visitorId}`,
        `${ADMIN}/risk`,
      ]) {
        await page.goto(APP + path);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          true,
          `${width} ${path}`,
        );
        const audit = await new AxeBuilder({ page })
          .withRules([
            "button-name",
            "label",
            "select-name",
            "aria-input-field-name",
          ])
          .analyze();
        assert.deepEqual(
          audit.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => n.target),
          })),
          [],
        );
      }
    }
    assert.deepEqual(errors, []);
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  socket?.close();
  await browser?.close();
  if (siteIds.length)
    await prisma.site.deleteMany({ where: { id: { in: siteIds } } });
  await prisma.$disconnect();
  await mkdir(artifacts, { recursive: true });
  await writeFile(
    `${artifacts}/results.json`,
    JSON.stringify(results, null, 2),
  );
  const passed = results.filter((r) => r.ok).length;
  console.log(
    `\n新功能端到端回归：${passed}/${results.length}；证据目录：${artifacts}`,
  );
  if (passed !== results.length || results.length !== 8) process.exitCode = 1;
}
