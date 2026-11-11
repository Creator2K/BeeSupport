import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { io } from "socket.io-client";
import bcrypt from "bcryptjs";
import { useTestDatabase } from "./test-environment.mjs";
import { connectSocket } from "./realtime-test-helpers.mjs";

useTestDatabase();
if (!process.env.TEST_APP_URL)
  throw new Error("TEST_APP_URL must select the authorized test application");
const APP = process.env.TEST_APP_URL.replace(/\/$/, "");
const ADMIN = process.env.ADMIN_PATH || "/admin";
const artifacts = "/tmp/beesupport-tenants-results";
const stamp = randomUUID().replaceAll("-", "").slice(0, 14);
const slugA = `hosted-${stamp}-a`,
  slugB = `hosted-${stamp}-b`;
const nameA = `托管商家 A ${stamp}`,
  nameB = `托管商家 B ${stamp}`;
const password = `Test-${stamp}!`;
const emailA = `${slugA}@test.local`,
  emailB = `${slugB}@test.local`;
const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1xkAAAAASUVORK5CYII=",
  "base64",
);
const results = [],
  sockets = [],
  ownedSiteIds = [];
let browser,
  page,
  adminPage,
  a,
  b,
  sa,
  sb,
  tokenA,
  tokenB,
  conversationA,
  conversationB,
  platformAction,
  siteAction;
const errors = [];
async function until(check, reason, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timeout: ${reason}`);
}
async function test(name, run) {
  try {
    await run();
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.stack });
    await page
      ?.screenshot({ path: `${artifacts}/failure.png`, fullPage: true })
      .catch(() => {});
    throw error;
  }
}
const auth = (token) => ({ authorization: `Bearer ${token}` });
async function assertStatus(response, status) {
  const body = await response.text();
  if (
    status === 404 &&
    response.status() === 200 &&
    /NEXT_HTTP_ERROR_FALLBACK;404|This page could not be found/.test(body)
  )
    return response;
  assert.equal(response.status(), status, body.slice(0, 500));
  return response;
}
async function cookieHeader(context) {
  return (await context.cookies(APP))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}
async function session(context, site) {
  const response = await context.request.post(`${APP}/api/widget/session`, {
    data: {
      key: site.publicKey,
      localKey: `visitor-${randomUUID()}`,
      email: `v-${stamp}@test.local`,
      pageUrl: `${APP}/example`,
    },
  });
  await assertStatus(response, 200);
  return (await response.json()).token;
}
async function post(context, token, body, conversationId) {
  return context.request.post(`${APP}/api/widget/conversation`, {
    headers: auth(token),
    data: {
      body,
      clientId: randomUUID(),
      ...(conversationId ? { conversationId } : {}),
    },
  });
}
async function upload(
  context,
  token,
  name = "test.png",
  buffer = png,
  mimeType = "image/png",
) {
  return context.request.post(`${APP}/api/widget/upload`, {
    headers: auth(token),
    multipart: { file: { name, mimeType, buffer } },
  });
}
async function replay(context, action, args, path = "/sites") {
  return context.request.post(`${APP}${ADMIN}${path}`, {
    headers: {
      "next-action": action,
      "content-type": "text/plain;charset=UTF-8",
      origin: APP,
    },
    data: JSON.stringify(args),
  });
}
try {
  await mkdir(artifacts, { recursive: true });
  await writeFile(
    `${artifacts}/pending-fixtures.json`,
    JSON.stringify({ slugs: [slugA, slugB] }),
  );
  await until(
    async () => {
      try {
        return (await fetch(`${APP}/api/health/ready`)).ok;
      } catch {
        return false;
      }
    },
    "application readiness",
    30000,
  );
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
  });
  const platform = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1440, height: 1000 },
  });
  const merchant = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1440, height: 1000 },
  });
  const other = await browser.newContext({ locale: "zh-CN" });
  const guest = await browser.newContext({ locale: "zh-CN" });
  adminPage = await platform.newPage();
  page = await merchant.newPage();
  for (const p of [adminPage, page]) {
    p.setDefaultTimeout(12000);
    p.on("pageerror", (error) =>
      errors.push(`${new URL(p.url()).pathname}: ${error.message}`),
    );
  }
  await assertStatus(
    await platform.request.post(`${APP}/api/auth/login`, {
      data: {
        email: process.env.SEED_ADMIN_EMAIL || "admin@beesupport.local",
        password: process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!",
      },
    }),
    200,
  );

  await test("商家申请、待审核登录限制、平台审核及套餐开通", async () => {
    const apply = await guest.newPage();
    await apply.goto(`${APP}/register`);
    for (const [id, value] of Object.entries({
      name: nameA,
      slug: slugA,
      ownerName: "商家 A 管理员",
      ownerEmail: emailA,
      ownerPassword: password,
    }))
      await apply.locator(`#register-${id}`).fill(value);
    await apply
      .getByRole("button", { name: "提交入驻申请", exact: true })
      .click();
    await apply.getByRole("status").filter({ hasText: "申请已提交" }).waitFor();
    a = await db.tenant.findUniqueOrThrow({ where: { slug: slugA } });
    assert.equal(a.status, "PENDING");
    await assertStatus(
      await merchant.request.post(`${APP}/api/auth/login`, {
        data: { email: emailA, password },
      }),
      403,
    );
    await adminPage.goto(`${APP}${ADMIN}/merchants`);
    await adminPage
      .locator("article")
      .filter({ hasText: nameA })
      .getByRole("button", { name: "审核 / 套餐 / 续期" })
      .click();
    const dialog = adminPage.getByRole("dialog");
    await dialog.locator("#merchant-status").selectOption("ACTIVE");
    for (const label of [
      "自定义底部品牌",
      "AI 自动回复与客服草稿",
      "整体访客画像统计",
    ])
      await dialog.getByLabel(label, { exact: true }).check();
    for (const [key, value] of Object.entries({
      maxAgents: 2,
      maxSites: 2,
      monthlyConversations: 2,
      storageMB: 1,
    }))
      await dialog.locator(`#merchant-${key}`).fill(String(value));
    const request = adminPage.waitForRequest(
      (req) => req.method() === "POST" && !!req.headers()["next-action"],
    );
    await dialog.getByRole("button", { name: "保存商家及套餐" }).click();
    platformAction = (await request).headers()["next-action"];
    await dialog.waitFor({ state: "hidden" });
    await until(
      async () =>
        (await db.tenant.findUnique({ where: { id: a.id } })).status ===
        "ACTIVE",
      "approval persisted",
    );
    await apply.close();
    b = await db.tenant.create({
      data: {
        name: nameB,
        slug: slugB,
        maxSites: 3,
        users: {
          create: {
            name: "商家 B 管理员",
            email: emailB,
            passwordHash: await bcrypt.hash(password, 10),
            role: "MERCHANT_ADMIN",
          },
        },
      },
    });
    sb = await db.site.create({
      data: {
        tenantId: b.id,
        name: `B 站点 ${stamp}`,
        slug: slugB,
        publicKey: slugB,
        autoAssign: false,
      },
    });
    ownedSiteIds.push(sb.id);
  });

  await test("商家登录及独立后台、真实建站、平台页面及管理操作越权拦截", async () => {
    await page.goto(`${APP}/login`);
    await page.locator("#email").fill(emailA);
    await page.locator("#password").fill(password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(`${APP}${ADMIN}/onboarding`);
    assert.equal(
      await page.getByRole("link", { name: "商家与套餐", exact: true }).count(),
      0,
    );
    await assertStatus(
      await other.request.post(`${APP}/api/auth/login`, {
        data: { email: emailB, password },
      }),
      200,
    );
    await assertStatus(
      await merchant.request.get(`${APP}${ADMIN}/merchants`),
      404,
    );
    await assertStatus(
      await merchant.request.get(`${APP}${ADMIN}/branding`),
      404,
    );
    await replay(
      merchant,
      platformAction,
      [
        {
          name: "越权篡改",
          slug: slugB,
          status: "ACTIVE",
          planName: "非法套餐",
          expiresAt: null,
          maxAgents: 999,
          maxSites: 999,
          monthlyConversations: 999,
          storageMB: 999,
          contactEmail: "",
          note: "",
        },
        b.id,
      ],
      "/merchants",
    );
    assert.equal(
      (await db.tenant.findUnique({ where: { id: b.id } })).name,
      nameB,
    );
    await page.goto(`${APP}${ADMIN}/sites`);
    assert.equal(await page.getByText(sb.name, { exact: true }).count(), 0);
    await page
      .getByRole("button", { name: "新建站点", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("站点名称", { exact: true })
      .fill(`A 站点 ${stamp}`);
    await dialog.getByLabel("站点标识", { exact: true }).fill(slugA);
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    sa = await db.site.findUniqueOrThrow({ where: { slug: slugA } });
    ownedSiteIds.push(sa.id);
    assert.equal(sa.tenantId, a.id);
    await db.site.update({ where: { id: sa.id }, data: { autoAssign: false } });
  });

  await test("商家默认配置保存、站点覆盖及真实聊天窗口同步生效", async () => {
    await page.goto(`${APP}${ADMIN}/organization`);
    for (const label of [
      "聊天窗口标题",
      "底部品牌文字（可留空）",
      "允许访客发送图片",
      "允许访客发送文件",
    ])
      await page.getByLabel(`覆盖：${label}`, { exact: true }).check();
    await page
      .getByLabel("聊天窗口标题", { exact: true })
      .fill(`A 专属客服 ${stamp}`);
    await page.getByLabel("底部品牌文字（可留空）", { exact: true }).fill("");
    await page.getByLabel("允许访客发送图片", { exact: true }).uncheck();
    await page.getByLabel("允许访客发送文件", { exact: true }).uncheck();
    await page
      .getByRole("button", { name: "保存默认配置", exact: true })
      .click();
    await until(
      async () =>
        (await db.tenant.findUnique({ where: { id: a.id } })).defaults
          .imagesEnabled === false,
      "brand defaults saved",
    );
    const config = await (
      await guest.request.get(`${APP}/api/widget/config?key=${sa.publicKey}`)
    ).json();
    assert.equal(config.site.title, `A 专属客服 ${stamp}`);
    assert.equal(config.site.imagesEnabled, false);
    assert.equal(config.site.footerText, "");
    assert.equal(JSON.stringify(config).includes("tenantId"), false);
    assert.equal(JSON.stringify(config).includes("storageMB"), false);
    tokenA = await session(guest, sa);
    tokenB = await session(guest, sb);
    await assertStatus(await upload(guest, tokenA), 403);
    await assertStatus(
      await upload(guest, tokenA, "a.txt", Buffer.from("hello"), "text/plain"),
      403,
    );
    const preview = await merchant.newPage();
    await preview.goto(`${APP}/preview?key=${sa.publicKey}`);
    await preview.locator(".beesupport-launcher").click();
    await preview
      .frameLocator('iframe[title="在线客服"]')
      .getByText(`A 专属客服 ${stamp}`, { exact: true })
      .waitFor();
    await preview.screenshot({
      path: `${artifacts}/merchant-preview.png`,
      fullPage: true,
    });
    await preview.close();
    await page.goto(`${APP}${ADMIN}/sites`);
    await page
      .getByRole("row")
      .filter({ hasText: sa.name })
      .locator('button[aria-haspopup="menu"]')
      .click();
    await page.getByRole("menuitem", { name: "编辑", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("覆盖：聊天窗口标题", { exact: true }).check();
    await dialog
      .getByLabel("聊天窗口标题", { exact: true })
      .fill(`站点专属标题 ${stamp}`);
    const request = page.waitForRequest(
      (req) => req.method() === "POST" && !!req.headers()["next-action"],
    );
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    siteAction = (await request).headers()["next-action"];
    await dialog.waitFor({ state: "hidden" });
    assert.equal(
      (
        await (
          await guest.request.get(
            `${APP}/api/widget/config?key=${sa.publicKey}`,
          )
        ).json()
      ).site.title,
      `站点专属标题 ${stamp}`,
    );
    const payload = {
      name: "跨商家站点篡改",
      slug: slugB,
      primaryColor: "#18181b",
      position: "right",
      welcomeMessage: "hello",
      offlineMessage: "offline",
      requireEmail: true,
      autoAssign: false,
      active: true,
      allowedOrigins: [],
      widgetSettings: {},
    };
    await replay(merchant, siteAction, [sb.id, payload]);
    assert.equal(
      (await db.site.findUnique({ where: { id: sb.id } })).name,
      sb.name,
    );
  });

  await test("会话、附件、访客详情、嵌入预览及实时消息不能跨商家读取", async () => {
    const socketA = await connectSocket(io, APP, {
      extraHeaders: { cookie: await cookieHeader(merchant) },
    });
    sockets.push(socketA);
    const socketB = await connectSocket(io, APP, {
      extraHeaders: { cookie: await cookieHeader(other) },
    });
    sockets.push(socketB);
    const seenA = [],
      seenB = [];
    socketA.on("conversation:created", (event) => seenA.push(event));
    socketB.on("conversation:created", (event) => seenB.push(event));
    const own = await post(guest, tokenA, "A 商家咨询");
    await assertStatus(own, 200);
    conversationA = (await own.json()).conversation.id;
    const foreign = await post(guest, tokenB, "B 商家保密咨询");
    await assertStatus(foreign, 200);
    conversationB = (await foreign.json()).conversation.id;
    await until(
      () =>
        seenA.some((e) => e.conversation.id === conversationA) &&
        seenB.some((e) => e.conversation.id === conversationB),
      "each tenant receives own events",
    );
    assert.equal(
      seenA.some((e) => e.conversation.id === conversationB),
      false,
    );
    assert.equal(
      seenB.some((e) => e.conversation.id === conversationA),
      false,
    );
    await assertStatus(
      await merchant.request.get(
        `${APP}/api/agent/conversations/${conversationB}`,
      ),
      403,
    );
    const list = await (
      await merchant.request.get(`${APP}/api/agent/conversations`)
    ).json();
    assert.ok(list.items.every((c) => c.siteId === sa.id));
    const visitorB = await db.visitor.findFirstOrThrow({
      where: { siteId: sb.id },
    });
    await assertStatus(
      await merchant.request.get(`${APP}${ADMIN}/visitors/${visitorB.id}`),
      404,
    );
    await assertStatus(
      await merchant.request.get(`${APP}/preview?key=${sb.publicKey}`),
      404,
    );
    const attachment = await (
      await assertStatus(await upload(guest, tokenB), 200)
    ).json();
    await assertStatus(
      await merchant.request.get(
        `${APP}/api/files/${attachment.attachment.id}`,
      ),
      403,
    );
    const ack = await new Promise((resolve) =>
      socketA.emit(
        "conversation:join",
        { conversationId: conversationB },
        resolve,
      ),
    );
    assert.equal(ack.ok, false);
  });

  await test("平台替商家设置的话术保留正确归属，仅对应商家可使用", async () => {
    await adminPage.goto(`${APP}${ADMIN}/canned`);
    await adminPage
      .getByRole("button", { name: "新建话术", exact: true })
      .first()
      .click();
    const dialog = adminPage.getByRole("dialog");
    await dialog
      .getByLabel("话术标题", { exact: true })
      .fill(`B 专属话术 ${stamp}`);
    await dialog
      .getByLabel("话术内容", { exact: true })
      .fill("平台替商家 B 配置的专属回复");
    await dialog
      .getByRole("combobox", { name: "适用范围", exact: true })
      .click();
    await adminPage.getByRole("option", { name: sb.name, exact: true }).click();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const item = await db.cannedResponse.findFirstOrThrow({
      where: { siteId: sb.id, title: `B 专属话术 ${stamp}` },
    });
    assert.equal(item.tenantId, b.id);
    const own = await (
      await other.request.get(`${APP}/api/agent/canned`)
    ).json();
    const foreign = await (
      await merchant.request.get(`${APP}/api/agent/canned`)
    ).json();
    assert.ok(own.items.some((r) => r.id === item.id));
    assert.ok(!foreign.items.some((r) => r.id === item.id));
  });

  await test("账号额度包含商家管理员，商家创建的管理员不会获得平台权限", async () => {
    await page.goto(`${APP}${ADMIN}/agents`);
    await page
      .getByRole("button", { name: "新建客服", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("姓名", { exact: true }).fill("A 二号管理员");
    await dialog
      .getByLabel("登录邮箱", { exact: true })
      .fill(`second-${emailA}`);
    await dialog.getByLabel("初始密码", { exact: true }).fill(password);
    await dialog.getByRole("radio", { name: "管理员", exact: true }).check();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const created = await db.user.findUniqueOrThrow({
      where: { email: `second-${emailA}` },
    });
    assert.equal(created.role, "MERCHANT_ADMIN");
    assert.equal(created.tenantId, a.id);
    await page
      .getByRole("button", { name: "新建客服", exact: true })
      .first()
      .click();
    await dialog.getByLabel("姓名", { exact: true }).fill("超限客服");
    await dialog
      .getByLabel("登录邮箱", { exact: true })
      .fill(`overflow-${emailA}`);
    await dialog.getByLabel("初始密码", { exact: true }).fill(password);
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await dialog
      .getByText("启用账号数已达套餐上限", { exact: false })
      .waitFor();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(
      await db.user.count({ where: { tenantId: a.id, active: true } }),
      2,
    );
  });

  await test("额度用尽不影响已有会话；新会话和上传无法突破套餐", async () => {
    const visitor = await db.visitor.findFirstOrThrow({
      where: { siteId: sa.id },
    });
    await db.conversation.create({
      data: { siteId: sa.id, visitorId: visitor.id, status: "CLOSED" },
    });
    await assertStatus(
      await post(guest, tokenA, "现有会话仍可继续", conversationA),
      200,
    );
    await db.conversation.update({
      where: { id: conversationA },
      data: { status: "CLOSED" },
    });
    await assertStatus(await post(guest, tokenA, "试图超额新建"), 403);
    await db.tenant.update({
      where: { id: a.id },
      data: {
        defaults: { imagesEnabled: true, filesEnabled: true, maxUploadMB: 1 },
      },
    });
    await db.site.update({
      where: { id: sa.id },
      data: { widgetSettings: {} },
    });
    await assertStatus(
      await upload(
        guest,
        tokenA,
        "too-big.txt",
        Buffer.alloc(1048577, 65),
        "text/plain",
      ),
      400,
    );
    const held = await assertStatus(
      await upload(
        guest,
        tokenA,
        "quota.txt",
        Buffer.alloc(1048575, 65),
        "text/plain",
      ),
      200,
    );
    assert.ok((await held.json()).attachment.id);
    await assertStatus(await upload(guest, tokenA), 403);
  });

  await test("商家后台 PC/移动端布局与可访问性检查", async () => {
    await page.goto(`${APP}${ADMIN}/organization`);
    await page.locator("h1").filter({ hasText: "商家配置与用量" }).waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      await page.screenshot({
        path: `${artifacts}/merchant-${width}.png`,
        fullPage: true,
      });
      const scan = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      assert.deepEqual(
        scan.violations.map((v) => ({ id: v.id, impact: v.impact })),
        [],
      );
    }
    await adminPage.goto(`${APP}${ADMIN}/merchants`);
    await adminPage
      .getByRole("heading", { name: "商家与套餐", exact: true })
      .waitFor();
    await adminPage.screenshot({
      path: `${artifacts}/platform-merchants.png`,
      fullPage: true,
    });
  });

  await test("到期停止访客接待并保留后台；续期恢复；停用立即撤销会话和登录", async () => {
    await db.tenant.update({
      where: { id: a.id },
      data: { expiresAt: new Date(Date.now() - 60000) },
    });
    await assertStatus(
      await guest.request.get(`${APP}/api/widget/config?key=${sa.publicKey}`),
      404,
    );
    await assertStatus(
      await guest.request.get(`${APP}/api/widget/conversation`, {
        headers: auth(tokenA),
      }),
      401,
    );
    await page.goto(`${APP}${ADMIN}/organization`);
    await page
      .getByText(
        "服务已到期，访客接待已暂停，历史记录保留。请联系平台管理员续期。",
        { exact: true },
      )
      .waitFor();
    await db.tenant.update({
      where: { id: a.id },
      data: { expiresAt: new Date(Date.now() + 86400000) },
    });
    await assertStatus(
      await guest.request.get(`${APP}/api/widget/config?key=${sa.publicKey}`),
      200,
    );
    await adminPage.goto(`${APP}${ADMIN}/merchants`);
    await adminPage
      .locator("article")
      .filter({ hasText: nameA })
      .getByRole("button", { name: "审核 / 套餐 / 续期" })
      .click();
    const dialog = adminPage.getByRole("dialog");
    await dialog.locator("#merchant-status").selectOption("SUSPENDED");
    await dialog.getByRole("button", { name: "保存商家及套餐" }).click();
    await dialog.waitFor({ state: "hidden" });
    await until(
      () => !sockets[0].connected,
      "suspension disconnects tenant socket",
    );
    await assertStatus(await merchant.request.get(`${APP}/api/auth/me`), 401);
    await assertStatus(
      await merchant.request.post(`${APP}/api/auth/login`, {
        data: { email: emailA, password },
      }),
      403,
    );
    assert.deepEqual(errors, []);
  });
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  for (const socket of sockets) socket.close();
  await browser?.close();
  const fixtures = await db.tenant.findMany({
    where: { slug: { in: [slugA, slugB] } },
    select: { id: true },
  });
  for (const tenant of fixtures) {
    const sites = await db.site.findMany({
      where: { tenantId: tenant.id },
      select: { id: true },
    });
    await db.site.deleteMany({ where: { tenantId: tenant.id } });
    for (const site of sites)
      await rm(
        join(resolve(process.env.UPLOAD_DIR || "./data/uploads"), site.id),
        { recursive: true, force: true },
      );
    await db.auditLog.deleteMany({ where: { tenantId: tenant.id } });
    await db.cannedResponse.deleteMany({ where: { tenantId: tenant.id } });
    await db.riskRule.deleteMany({ where: { tenantId: tenant.id } });
    await db.user.deleteMany({ where: { tenantId: tenant.id } });
    await db.tenant.delete({ where: { id: tenant.id } });
  }
  await db.$disconnect();
  await writeFile(
    `${artifacts}/results.json`,
    JSON.stringify(results, null, 2),
  );
  await rm(`${artifacts}/pending-fixtures.json`, { force: true });
  console.log(
    `${results.filter((r) => r.ok).length}/${results.length} hosted integration groups passed; owned fixtures removed`,
  );
}
