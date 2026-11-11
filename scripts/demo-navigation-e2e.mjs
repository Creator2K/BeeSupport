import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { waitForSettledPage } from "./browser-test-helpers.mjs";
import { useTestDatabase } from "./test-environment.mjs";

useTestDatabase();
if (!process.env.TEST_APP_URL) throw new Error("请指定 TEST_APP_URL");
const app = process.env.TEST_APP_URL.replace(/\/$/, "");
const admin = process.env.ADMIN_PATH || "/admin";
const password = process.env.DEMO_PASSWORD || "Demo123456!";
const artifacts = "/tmp/beesupport-demo-navigation-results";
const errors = [];
const results = [];
let browser;
const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();

async function check(name, run) {
  await run();
  results.push(name);
  console.log(`PASS: ${name}`);
}
async function settle(page) {
  await waitForSettledPage(page);
}
async function login(context, email, status = 200, pass = password) {
  const response = await context.request.post(`${app}/api/auth/login`, {
    data: { email, password: pass },
  });
  assert.equal(response.status(), status, await response.text());
}
async function newPage(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) =>
    errors.push(`${page.url()}: ${error.message}`),
  );
  return page;
}
async function noOverflow(page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
}
async function axe(page, selector) {
  await settle(page);
  const result = await new AxeBuilder({ page })
    .include(selector)
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
  );
}
try {
  await mkdir(artifacts, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
  });
  const platform = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1440, height: 900 },
  });
  const merchant = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1440, height: 900 },
  });
  const page = await newPage(platform);
  const shop = await newPage(merchant);
  await login(
    platform,
    process.env.SEED_ADMIN_EMAIL || "admin@beesupport.local",
    200,
    process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!",
  );
  await login(merchant, "shop@demo.beesupport.local");

  await check("演示数据关联、图片资源与待处理状态完整", async () => {
    assert.equal(
      await db.tenant.count({ where: { id: { startsWith: "bs_demo_v1_" } } }),
      5,
    );
    assert.equal(
      await db.visitor.count({ where: { id: { startsWith: "bs_demo_v1_" } } }),
      128,
    );
    assert.equal(
      await db.conversation.count({
        where: { id: { startsWith: "bs_demo_v1_" } },
      }),
      64,
    );
    assert.equal(
      await db.subscriptionOrder.count({
        where: { id: { startsWith: "bs_demo_v1_" } },
      }),
      7,
    );
    const image = await db.attachment.findUniqueOrThrow({
      where: { id: "bs_demo_v1_image_attachment" },
      include: {
        message: { include: { conversation: { include: { visitor: true } } } },
      },
    });
    const visitor = image.message.conversation.visitor;
    assert.equal(image.siteId, image.message.conversation.siteId);
    assert.equal(image.siteId, visitor.siteId);
    assert.equal(image.imageReviewState, "PENDING");
    assert.equal(visitor.pendingImageId, image.id);
    const response = await merchant.request.get(`${app}/api/files/${image.id}`);
    assert.equal(response.status(), 200);
    assert.match(response.headers()["content-type"], /image\/png/);
    assert.ok((await response.body()).length > 1000);
  });
  await check("平台分组、待处理数量、键盘折叠及偏好持久化", async () => {
    await page.goto(`${app}${admin}`);
    const sidebar = page.getByTestId("desktop-sidebar");
    await sidebar
      .getByRole("link", { name: "商家管理", exact: true })
      .waitFor();
    const pending = await db.tenant.count({ where: { status: "PENDING" } });
    assert.equal(
      await sidebar
        .getByRole("link", { name: "商家管理", exact: true })
        .getAttribute("title"),
      `商家管理 · ${pending} 项待处理`,
    );
    const operations = sidebar.getByRole("button", { name: "平台运营" });
    await operations.focus();
    await page.keyboard.press("Enter");
    assert.equal(await operations.getAttribute("aria-expanded"), "false");
    await page.reload();
    assert.equal(await operations.getAttribute("aria-expanded"), "false");
    await operations.click();
    await page.getByRole("button", { name: "收起侧边栏", exact: true }).click();
    assert.equal(await sidebar.getAttribute("data-collapsed"), "true");
    await sidebar
      .getByRole("link", { name: "系统设置", exact: true })
      .waitFor();
    await page.reload();
    await page
      .getByRole("button", { name: "展开侧边栏", exact: true })
      .waitFor();
    assert.equal(await sidebar.getAttribute("data-collapsed"), "true");
    await page.screenshot({
      path: `${artifacts}/platform-compact.png`,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "展开侧边栏", exact: true }).click();
    await axe(page, '[data-testid="desktop-sidebar"]');
    await page.screenshot({
      path: `${artifacts}/platform-desktop.png`,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1280, height: 600 });
    const footer = await sidebar
      .getByRole("button", { name: /账号设置/ })
      .boundingBox();
    assert.ok(footer && footer.y + footer.height <= 600);
    const scroll = await sidebar
      .locator("nav")
      .evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }));
    assert.ok(scroll.scroll > scroll.client);
    await noOverflow(page);
  });
  await check("深层页面高亮、自动展开配置组及暗色可访问性", async () => {
    await page.goto(`${app}${admin}/visitors/list`);
    assert.equal(
      await page
        .getByTestId("desktop-sidebar")
        .getByRole("link", { name: "访客画像", exact: true })
        .getAttribute("aria-current"),
      "page",
    );
    await page.goto(`${app}${admin}/risk`);
    const sidebar = page.getByTestId("desktop-sidebar");
    assert.equal(
      await sidebar
        .getByRole("button", { name: "系统设置", exact: true })
        .getAttribute("aria-expanded"),
      "true",
    );
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    });
    await axe(page, '[data-testid="desktop-sidebar"]');
    await page.screenshot({
      path: `${artifacts}/platform-dark.png`,
      animations: "disabled",
    });
  });
  await check("商家菜单、画像及续费数据仅展示自己的商家", async () => {
    await shop.goto(`${app}${admin}/subscription`);
    const sidebar = shop.getByTestId("desktop-sidebar");
    await sidebar.getByText("云杉商城（演示）", { exact: true }).waitFor();
    for (const label of [
      "商家配置与用量",
      "套餐与续费",
      "站点管理",
      "客服账号",
    ])
      assert.equal(
        await sidebar
          .getByRole("link", { name: label, exact: true })
          .isVisible(),
        true,
      );
    // 商家管理员可以配置自己商家的 AI 策略，侧栏里的 AI 入口不属于平台专用页面。
    for (const path of [
      "merchants",
      "plans",
      "orders",
      "branding",
      "settings",
    ])
      assert.equal(
        await sidebar.locator(`a[href="${admin}/${path}"]`).count(),
        0,
      );
    assert.ok(
      (await shop.locator("main").innerText()).includes("DEMO-V1-SHOP-PENDING"),
    );
    assert.ok(
      !(await shop.locator("main").innerText()).includes(
        "DEMO-V1-TECH-PENDING",
      ),
    );
    await shop.goto(`${app}${admin}/visitors`);
    await shop
      .getByRole("heading", { name: "访客画像", exact: true })
      .waitFor();
    await noOverflow(shop);
    await shop.screenshot({
      path: `${artifacts}/merchant-analytics.png`,
      animations: "disabled",
    });
  });
  await check("320/375 像素手机菜单、导航关闭与底部账号入口", async () => {
    for (const width of [375, 320]) {
      await shop.setViewportSize({ width, height: 667 });
      await shop.goto(`${app}${admin}`);
      await noOverflow(shop);
      await shop.getByRole("button", { name: "打开导航菜单" }).click();
      const drawer = shop.getByRole("dialog", { name: "后台导航" });
      await drawer.waitFor();
      const bounds = await drawer.boundingBox();
      assert.ok(bounds && bounds.width <= width && bounds.height <= 667);
      const footer = await drawer
        .getByRole("button", { name: /账号设置/ })
        .boundingBox();
      assert.ok(footer && footer.y + footer.height <= 667);
      await axe(shop, '[role="dialog"]');
      await shop.screenshot({
        path: `${artifacts}/merchant-mobile-${width}.png`,
        animations: "disabled",
      });
      await drawer
        .getByRole("link", { name: "套餐与续费", exact: true })
        .click();
      await drawer.waitFor({ state: "hidden" });
      await shop
        .getByRole("heading", { name: "套餐与续费", exact: true })
        .waitFor();
      await noOverflow(shop);
    }
  });
  await check("到期可续费、待审核及停用限制、客服跳转工作台", async () => {
    for (const [email, status] of [
      ["education@demo.beesupport.local", 200],
      ["pending@demo.beesupport.local", 403],
      ["studio@demo.beesupport.local", 403],
      ["agent@demo.beesupport.local", 200],
    ]) {
      const context = await browser.newContext({ locale: "zh-CN" });
      await login(context, email, status);
      if (email.startsWith("education")) {
        const expired = await newPage(context);
        await expired.goto(`${app}${admin}/subscription`);
        await expired
          .getByRole("heading", { name: "套餐与续费", exact: true })
          .waitFor();
        assert.match(
          await expired.getByRole("status").first().innerText(),
          /已到期/,
        );
      }
      if (email.startsWith("agent")) {
        const agent = await newPage(context);
        await agent.goto(`${app}${admin}`);
        await agent.waitForURL(`${app}/agent`);
      }
      await context.close();
    }
  });
  assert.deepEqual(errors, []);
  console.log(`${results.length} groups passed; no browser exceptions`);
} finally {
  await writeFile(
    `${artifacts}/results.json`,
    JSON.stringify({ results, errors }, null, 2),
  );
  await browser?.close();
  await db.$disconnect();
}
