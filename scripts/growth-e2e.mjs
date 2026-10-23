import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { useTestDatabase, restoreSetting } from "./test-environment.mjs";
useTestDatabase();
if (!process.env.TEST_APP_URL)
  throw new Error("TEST_APP_URL must select the authorized test app");
const APP = process.env.TEST_APP_URL.replace(/\/$/, ""),
  ADMIN = process.env.ADMIN_PATH || "/admin",
  artifacts = "/tmp/beesupport-growth-results";
const { prisma: db } = await import("../src/lib/db.ts");
const { generateExpiryNotices } =
  await import("../src/server/services/subscription-reminders.ts");
const { readHomeDocument } = await import("../src/lib/homepage-validation.ts");
const stamp = randomUUID().replaceAll("-", "").slice(0, 12),
  password = `Test-${stamp}!`,
  tenantIds = [],
  userIds = [],
  planIds = [],
  results = [],
  errors = [];
const keys = [
    "homepage.draft",
    "homepage.published",
    "subscriptions.reminders",
  ],
  saved = await Promise.all(
    keys.map((key) => db.setting.findUnique({ where: { key } })),
  );
const original = readHomeDocument(saved[1]?.value).content;
let browser, page, platform, a, b, site;
async function until(check, message, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timeout: ${message}`);
}
async function test(name, run) {
  try {
    await run();
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.stack });
    await page
      ?.screenshot({
        path: `${artifacts}/failure.png`,
        fullPage: true,
        animations: "disabled",
      })
      .catch(() => {});
    throw error;
  }
}
async function settle(p = page) {
  await p.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => Number.isFinite(a.effect?.getTiming().iterations))
        .map((a) => a.finished.catch(() => {})),
    );
  });
}
async function axe(p = page) {
  await settle(p);
  const scan = await new AxeBuilder({ page: p })
    .exclude("nextjs-portal")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    scan.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
    [],
  );
}
async function width(p = page) {
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
}
async function newPage(context) {
  const p = await context.newPage();
  p.setDefaultTimeout(45000);
  p.on("pageerror", (error) => errors.push(`${p.url()}: ${error.message}`));
  p.on("response", (response) => {
    if (response.status() >= 400 && response.url().includes("/_next/"))
      errors.push(`Asset ${response.status()}: ${response.url()}`);
  });
  return p;
}
async function login(context, user) {
  const r = await context.request.post(`${APP}/api/auth/login`, {
    data: { email: user.email, password },
  });
  assert.equal(r.status(), 200, await r.text());
  return r.json();
}
async function denied(response) {
  const body = await response.text();
  assert.ok(
    [403, 404].includes(response.status()) ||
      (response.status() === 200 &&
        /NEXT_HTTP_ERROR_FALLBACK;404|This page could not be found/.test(body)),
    body.slice(0, 300),
  );
}
try {
  await mkdir(artifacts, { recursive: true });
  await until(async () => {
    try {
      return (await fetch(`${APP}/api/health/ready`)).ok;
    } catch {
      return false;
    }
  }, "app readiness");
  const base = await db.user.findFirstOrThrow({
    where: { role: "ADMIN", active: true },
    select: { tenantId: true },
  });
  platform = await db.user.create({
    data: {
      tenantId: base.tenantId,
      name: "运营功能验收",
      email: `growth-ui-platform-${stamp}@test.local`,
      role: "ADMIN",
      passwordHash: await bcrypt.hash(password, 10),
    },
  });
  userIds.push(platform.id);
  const merchants = [];
  for (const suffix of ["a", "b"]) {
    const tenant = await db.tenant.create({
      data: {
        name: `向导验收 ${suffix} ${stamp}`,
        slug: `growth-ui-${stamp}-${suffix}`,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 2 * 86400000),
        users: {
          create: {
            name: `商家${suffix}`,
            email: `growth-ui-${stamp}-${suffix}@test.local`,
            role: "MERCHANT_ADMIN",
            passwordHash: await bcrypt.hash(password, 10),
          },
        },
      },
      include: { users: true },
    });
    tenantIds.push(tenant.id);
    merchants.push(tenant.users[0]);
  }
  [a, b] = merchants;
  await db.setting.upsert({
    where: { key: keys[2] },
    create: {
      key: keys[2],
      value: {
        revision: stamp,
        settings: { enabled: true, mailEnabled: false, leadDays: 7 },
      },
    },
    update: {
      value: {
        revision: stamp,
        settings: { enabled: true, mailEnabled: false, leadDays: 7 },
      },
    },
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
  });
  const merchant = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 1440, height: 1000 },
    }),
    operator = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 1440, height: 1000 },
    }),
    other = await browser.newContext({ locale: "zh-CN" });
  const merchantPage = await newPage(merchant),
    operatorPage = await newPage(operator),
    publicPage = await newPage(
      await browser.newContext({
        locale: "zh-CN",
        viewport: { width: 1440, height: 1000 },
      }),
    );
  const destination = await login(merchant, a);
  await login(operator, platform);
  await login(other, b);
  await test("新商家首次登录接入向导、真实建站和站点进度", async () => {
    page = merchantPage;
    assert.equal(destination.redirectTo, `${ADMIN}/onboarding`);
    await page.goto(`${APP}${destination.redirectTo}`);
    await page
      .getByRole("heading", { name: "接入向导", exact: true })
      .waitFor();
    assert.equal(
      await page.getByRole("progressbar").getAttribute("aria-valuenow"),
      "0",
    );
    await page.getByRole("link", { name: "管理站点", exact: true }).click();
    await page
      .getByRole("button", { name: "新建站点", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("站点名称", { exact: true })
      .fill(`首个站点 ${stamp}`);
    await dialog
      .getByLabel("站点标识", { exact: true })
      .fill(`growth-ui-site-${stamp}`);
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    site = await db.site.findUniqueOrThrow({
      where: { slug: `growth-ui-site-${stamp}` },
    });
    assert.equal(site.tenantId, a.tenantId);
    await page.goto(`${APP}${ADMIN}/onboarding`);
    assert.equal(
      await page.getByRole("progressbar").getAttribute("aria-valuenow"),
      "1",
    );
    assert.match(
      await page.getByLabel("本站点嵌入代码").inputValue(),
      new RegExp(site.publicKey),
    );
    await axe();
    await page.screenshot({
      path: `${artifacts}/onboarding-desktop.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await width();
    await axe();
    await page.screenshot({
      path: `${artifacts}/onboarding-mobile.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const otherPage = await newPage(other);
    await otherPage.goto(`${APP}${ADMIN}/onboarding`);
    assert.equal(
      await otherPage.getByRole("progressbar").getAttribute("aria-valuenow"),
      "0",
    );
    assert.equal(
      await otherPage
        .locator("main")
        .getByText(site.name, { exact: true })
        .count(),
      0,
    );
    await otherPage.close();
  });
  await test("预览试聊不误报接入，真实宿主窗口上报完成检测", async () => {
    page = await newPage(merchant);
    await page.goto(`${APP}/preview?key=${site.publicKey}`);
    await page.locator(".beesupport-launcher").click();
    const frame = page.frameLocator('iframe[title="在线客服"]');
    await frame.locator("#visitor-email").fill(`visitor-${stamp}@example.test`);
    await frame.getByRole("button", { name: "开始对话", exact: true }).click();
    await frame
      .getByPlaceholder("输入消息…", { exact: true })
      .fill(`向导试聊 ${stamp}`);
    await frame.getByRole("button", { name: "发送", exact: true }).click();
    await until(
      async () =>
        (await db.message.count({ where: { body: `向导试聊 ${stamp}` } })) > 0,
      "trial message persisted",
    );
    assert.equal(
      (await db.site.findUniqueOrThrow({ where: { id: site.id } })).embedSeenAt,
      null,
    );
    await merchantPage.goto(`${APP}${ADMIN}/onboarding`);
    assert.equal(
      await merchantPage.getByRole("progressbar").getAttribute("aria-valuenow"),
      "2",
    );
    await page.goto(APP);
    await page.evaluate((key) => {
      const script = document.createElement("script");
      script.src = `/widget.js?key=${encodeURIComponent(key)}`;
      document.body.appendChild(script);
    }, site.publicKey);
    await until(
      async () =>
        Boolean(
          (await db.site.findUniqueOrThrow({ where: { id: site.id } }))
            .embedSeenAt,
        ),
      "real host installation report",
    );
    await merchantPage
      .getByRole("button", { name: "刷新接入状态", exact: true })
      .click();
    await until(
      async () =>
        (await merchantPage
          .getByRole("progressbar")
          .getAttribute("aria-valuenow")) === "3",
      "guide refresh completes all steps",
    );
    await merchantPage.getByText("已完成基础接入", { exact: false }).waitFor();
    await merchantPage.goto(`${APP}${ADMIN}`);
    assert.equal(
      await merchantPage.getByText("继续完成站点接入", { exact: true }).count(),
      0,
    );
    await page.close();
  });
  let draftAction;
  const brand = `新品牌验收 ${stamp}`,
    question = `如何开启验收服务 ${stamp}？`,
    answer = "欢迎 <script>window.__homeXss=1</script> 使用测试。";
  const plan = await db.subscriptionPlan.create({
    data: {
      name: `首页套餐验收 ${stamp}`,
      description: "测试展示报价",
      priceCents: 8888,
      durationDays: 30,
      maxAgents: 5,
      maxSites: 3,
      monthlyConversations: 3000,
      storageMB: 1024,
      active: true,
    },
  });
  planIds.push(plan.id);
  await test("首页草稿独立保存、并发冲突、全宽预览与发布", async () => {
    page = operatorPage;
    await page.goto(`${APP}${ADMIN}/homepage`);
    const stale = await newPage(operator);
    await stale.goto(`${APP}${ADMIN}/homepage`);
    await page.getByLabel("首页品牌名", { exact: true }).fill(brand);
    await page.getByLabel("问题 1 标题", { exact: true }).fill(question);
    await page.getByLabel("问题 1 回答", { exact: true }).fill(answer);
    await page.getByLabel(new RegExp(plan.name)).check();
    const request = page.waitForRequest(
      (req) => req.method() === "POST" && Boolean(req.headers()["next-action"]),
    );
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    draftAction = (await request).headers()["next-action"];
    await until(
      async () =>
        (await db.setting.findUnique({ where: { key: keys[0] } }))?.value
          ?.content?.brandName === brand,
      "homepage draft saved",
    );
    await publicPage.goto(APP);
    await publicPage
      .getByRole("link", { name: `${original.brandName} 首页`, exact: true })
      .waitFor();
    assert.equal(
      await publicPage
        .getByRole("link", { name: `${brand} 首页`, exact: true })
        .count(),
      0,
    );
    await stale
      .getByLabel("首页品牌名", { exact: true })
      .fill(`旧版本 ${stamp}`);
    await stale.getByRole("button", { name: "保存草稿", exact: true }).click();
    await stale
      .getByRole("alert")
      .filter({ hasText: "草稿已被其他管理员修改" })
      .waitFor();
    await stale.close();
    const popupPromise = page.waitForEvent("popup");
    await page
      .getByRole("button", { name: "预览已保存草稿", exact: true })
      .click();
    const preview = await popupPromise;
    preview.setDefaultTimeout(45000);
    await preview
      .getByRole("link", { name: `${brand} 首页`, exact: true })
      .waitFor();
    assert.equal(await preview.getByTestId("desktop-sidebar").count(), 0);
    await preview.setViewportSize({ width: 320, height: 812 });
    await width(preview);
    await axe(preview);
    await preview.close();
    await page.getByRole("button", { name: "发布到首页", exact: true }).click();
    await until(
      async () =>
        (await db.setting.findUnique({ where: { key: keys[1] } }))?.value
          ?.content?.brandName === brand,
      "homepage published",
    );
    await publicPage.reload();
    await publicPage
      .getByRole("link", { name: `${brand} 首页`, exact: true })
      .waitFor();
    await publicPage.locator("summary").filter({ hasText: question }).click();
    await publicPage.getByText(answer, { exact: true }).waitFor();
    assert.equal(
      await publicPage.evaluate(() => typeof window.__homeXss),
      "undefined",
    );
    await publicPage
      .getByRole("heading", { name: plan.name, exact: true })
      .waitFor();
    await axe(publicPage);
    await publicPage.screenshot({
      path: `${artifacts}/published-home.png`,
      fullPage: true,
      animations: "disabled",
    });
    await db.subscriptionPlan.update({
      where: { id: plan.id },
      data: { active: false },
    });
    await publicPage.reload();
    assert.equal(
      await publicPage
        .getByRole("heading", { name: plan.name, exact: true })
        .count(),
      0,
    );
    await page.reload();
    await page.setViewportSize({ width: 375, height: 812 });
    await width();
    await axe();
    await page.screenshot({
      path: `${artifacts}/homepage-editor-mobile.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await test("商家不能读取草稿、进入平台配置或重放首页写操作", async () => {
    page = merchantPage;
    for (const path of [
      `${ADMIN}/homepage`,
      `${ADMIN}/reminders`,
      "/home-preview",
    ])
      await denied(await merchant.request.get(`${APP}${path}`));
    const current = await db.setting.findUniqueOrThrow({
      where: { key: keys[0] },
    });
    await merchant.request.post(`${APP}${ADMIN}/homepage`, {
      headers: {
        "next-action": draftAction,
        "content-type": "text/plain;charset=UTF-8",
        origin: APP,
      },
      data: JSON.stringify([
        { ...current.value.content, brandName: "越权篡改" },
        current.value.revision,
      ]),
    });
    assert.equal(
      (await db.setting.findUniqueOrThrow({ where: { key: keys[0] } })).value
        .revision,
      current.value.revision,
    );
    const guest = await browser.newContext();
    const response = await guest.request.get(`${APP}/home-preview`, {
      maxRedirects: 0,
    });
    assert.equal(response.status(), 307);
    assert.match(response.headers().location, /\/login/);
    await guest.close();
  });
  await test("到期提醒配置、通知账号隔离、已读和续期失效", async () => {
    page = operatorPage;
    await page.goto(`${APP}${ADMIN}/reminders`);
    assert.equal(
      await page
        .getByLabel("同时发送邮件给商家管理员", { exact: true })
        .isChecked(),
      false,
    );
    await page.getByLabel("提前提醒时间", { exact: true }).selectOption("14");
    await page
      .getByRole("button", { name: "保存提醒配置", exact: true })
      .click();
    await until(
      async () =>
        (await db.setting.findUniqueOrThrow({ where: { key: keys[2] } })).value
          .settings.leadDays === 14,
      "reminder setting saved",
    );
    await axe();
    await generateExpiryNotices(new Date(), undefined, tenantIds);
    const noticeA = await db.accountNotice.findFirstOrThrow({
        where: { userId: a.id, kind: "subscription.expiry" },
      }),
      privateNotice = await db.accountNotice.create({
        data: {
          tenantId: a.tenantId,
          userId: a.id,
          kind: "test.private",
          dedupeKey: stamp,
          title: `仅管理员 A 可读 ${stamp}`,
          body: "不允许跨账号读取。",
        },
      });
    page = merchantPage;
    await page.goto(`${APP}${ADMIN}/notifications`);
    await page
      .getByRole("heading", { name: privateNotice.title, exact: false })
      .waitFor();
    const article = page.locator("article").filter({ hasText: noticeA.title });
    const actionRequest = page.waitForRequest(
      (req) => req.method() === "POST" && Boolean(req.headers()["next-action"]),
    );
    await article
      .getByRole("button", { name: "标为已读", exact: true })
      .click();
    const action = (await actionRequest).headers()["next-action"];
    await until(
      async () =>
        Boolean(
          (
            await db.accountNotice.findUniqueOrThrow({
              where: { id: noticeA.id },
            })
          ).readAt,
        ),
      "mark notice read",
    );
    const otherPage = await newPage(other);
    await otherPage.goto(`${APP}${ADMIN}/notifications`);
    assert.equal(
      await otherPage.getByText(privateNotice.title, { exact: false }).count(),
      0,
    );
    await other.request.post(`${APP}${ADMIN}/notifications`, {
      headers: {
        "next-action": action,
        "content-type": "text/plain;charset=UTF-8",
        origin: APP,
      },
      data: JSON.stringify([privateNotice.id]),
    });
    assert.equal(
      (
        await db.accountNotice.findUniqueOrThrow({
          where: { id: privateNotice.id },
        })
      ).readAt,
      null,
    );
    await otherPage.close();
    await page.setViewportSize({ width: 375, height: 812 });
    await width();
    await axe();
    await page.screenshot({
      path: `${artifacts}/notifications-mobile.png`,
      fullPage: true,
      animations: "disabled",
    });
    await db.tenant.update({
      where: { id: a.tenantId },
      data: { expiresAt: new Date(Date.now() + 30 * 86400000) },
    });
    await page.reload();
    assert.equal(
      await page.locator("article").filter({ hasText: noticeA.title }).count(),
      0,
    );
    assert.equal(
      await page
        .locator("article")
        .filter({ hasText: privateNotice.title })
        .count(),
      1,
    );
  });
  assert.deepEqual(errors, []);
  console.log(`${results.length} growth browser groups passed; no page errors`);
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  await browser?.close();
  const notices = await db.accountNotice.findMany({
    where: { tenantId: { in: tenantIds } },
    select: { mailJobId: true },
  });
  await db.notificationJob.deleteMany({
    where: {
      id: {
        in: notices.flatMap((row) => (row.mailJobId ? [row.mailJobId] : [])),
      },
    },
  });
  const sites = await db.site.findMany({
    where: { tenantId: { in: tenantIds } },
    select: { id: true },
  });
  await db.site.deleteMany({ where: { tenantId: { in: tenantIds } } });
  for (const site of sites)
    await rm(`data/uploads/${site.id}`, { recursive: true, force: true });
  await db.accountNotice.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { tenantId: { in: tenantIds } },
        ...(platform ? [{ actorId: platform.id }] : []),
      ],
    },
  });
  await db.user.deleteMany({
    where: { OR: [{ tenantId: { in: tenantIds } }, { id: { in: userIds } }] },
  });
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await db.subscriptionPlan.deleteMany({ where: { id: { in: planIds } } });
  for (let i = 0; i < keys.length; i++)
    await restoreSetting(db, keys[i], saved[i]);
  await db.$disconnect();
  await writeFile(
    `${artifacts}/results.json`,
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(
    "Owned growth fixtures removed; homepage and reminder settings restored",
  );
}
