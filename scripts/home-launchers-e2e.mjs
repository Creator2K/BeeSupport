import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import bcrypt from "bcryptjs";
import { useTestDatabase } from "./test-environment.mjs";

useTestDatabase();
if (!process.env.TEST_APP_URL) throw new Error("请指定 TEST_APP_URL");
const app = process.env.TEST_APP_URL.replace(/\/$/, "");
const admin = process.env.ADMIN_PATH || "/admin";
const artifacts = "/tmp/beesupport-home-launchers-results";
const stamp = randomUUID().replaceAll("-", "").slice(0, 12);
const slug = `launcher-${stamp}`;
const email = `${slug}@test.local`;
const password = `Test-${stamp}!`;
const kinds = ["bubble", "rounded", "pill", "outline", "soft", "avatar"];
const labels = [
  "经典圆形",
  "圆角方形",
  "文字胶囊",
  "轻盈描边",
  "柔和底色",
  "品牌头像",
];
const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();
const errors = [],
  results = [];
let browser, tenant, site, page;

async function until(check, message, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timeout: ${message}`);
}
async function test(name, run) {
  if (
    process.env.E2E_TEST_FILTER &&
    !new RegExp(process.env.E2E_TEST_FILTER).test(name)
  )
    return;
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
async function settle() {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => Number.isFinite(a.effect?.getTiming().iterations))
        .map((a) => a.finished.catch(() => {})),
    );
  });
}
async function noOverflow() {
  const size = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert.ok(size.document <= size.viewport, JSON.stringify(size));
}
async function axe(include) {
  await settle();
  let builder = new AxeBuilder({ page }).withTags([
    "wcag2a",
    "wcag2aa",
    "wcag21aa",
  ]);
  if (include) builder = builder.include(include);
  const result = await builder.analyze();
  assert.deepEqual(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
    [],
  );
}
async function embed(extra = "") {
  await page.goto(`${app}/preview?key=${site.publicKey}`);
  const launcher = page.locator(".beesupport-launcher");
  await until(
    async () => (await launcher.getAttribute("aria-label")) === "联系小蜂",
    "iframe ready applies launcher settings",
  );
  if (extra) {
    await page.evaluate((parameters) => {
      const current = document.querySelector("[data-preview-embed] script");
      const url = new URL(current.src);
      for (const [key, value] of new URLSearchParams(parameters))
        url.searchParams.set(key, value);
      window.BeeSupport.destroy();
      const script = document.createElement("script");
      script.src = url.href;
      document.body.appendChild(script);
    }, extra);
    const expected = new URLSearchParams(extra).get("label") || "联系小蜂";
    await until(
      async () => (await launcher.getAttribute("aria-label")) === expected,
      "embed query overrides apply",
    );
  }
  await settle();
  return launcher;
}
try {
  await mkdir(artifacts, { recursive: true });
  await until(
    async () => {
      try {
        return (await fetch(`${app}/api/health/ready`)).ok;
      } catch {
        return false;
      }
    },
    "application readiness",
    45000,
  );
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
  });
  const context = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1440, height: 1000 },
  });
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) =>
    errors.push(`${page.url()}: ${error.message}`),
  );
  page.on("response", (response) => {
    if (response.url().includes("/_next/") && response.status() >= 400)
      errors.push(`Static asset ${response.status()}: ${response.url()}`);
  });
  await test("首页内容、入驻登录入口、六种外观及本地对话演示", async () => {
    const visitorRequests = [];
    const listener = (request) => {
      if (/\/api\/widget\//.test(request.url()))
        visitorRequests.push(request.url());
    };
    page.on("request", listener);
    await page.goto(app);
    await page.getByRole("heading", { level: 1 }).waitFor();
    assert.equal(
      await page
        .getByRole("link", { name: "开启你的客服空间" })
        .getAttribute("href"),
      "/register",
    );
    assert.equal(
      await page
        .getByRole("link", { name: "登录控制台", exact: true })
        .first()
        .getAttribute("href"),
      "/login",
    );
    await noOverflow();
    await page.screenshot({
      path: `${artifacts}/home-desktop.png`,
      fullPage: true,
      animations: "disabled",
    });
    await axe();
    const choices = page.getByRole("group", { name: "体验悬浮按钮样式" });
    for (let i = 0; i < kinds.length; i++) {
      await choices
        .getByRole("button", { name: labels[i], exact: true })
        .click();
      await until(
        async () =>
          (await page
            .getByRole("button", { name: "打开演示客服" })
            .locator("[data-launcher-style]")
            .getAttribute("data-launcher-style")) === kinds[i],
        `home demo switches to ${kinds[i]}`,
      );
    }
    await page.getByRole("button", { name: "文字胶囊", exact: true }).click();
    await page.getByRole("button", { name: "暖阳黄", exact: true }).click();
    await page.getByRole("button", { name: "打开演示客服" }).click();
    await page
      .getByRole("button", { name: "可以接入多个网站吗？", exact: true })
      .click();
    await page
      .getByText(
        "可以。一个工作台统一接待多个站点，每个站点都能单独设置外观、欢迎语和客服团队。",
        { exact: true },
      )
      .waitFor();
    await until(
      () =>
        page.getByRole("log", { name: "演示聊天记录" }).evaluate((el) => {
          const bounds = el.getBoundingClientRect();
          const latest = el.lastElementChild.getBoundingClientRect();
          return (
            latest.bottom <= bounds.bottom + 1 && latest.top >= bounds.top - 1
          );
        }),
      "latest demo reply scrolls into view",
    );
    await axe('[data-testid="appearance-demo"]');
    await page.getByTestId("appearance-demo").screenshot({
      path: `${artifacts}/home-appearance.png`,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "关闭演示窗口" }).click();
    await page
      .locator("summary")
      .filter({ hasText: "接入网站需要做什么？" })
      .click();
    assert.equal(await page.locator("details[open]").count(), 1);
    assert.deepEqual(visitorRequests, []);
    page.off("request", listener);
  });
  await test("首页手机窄屏布局、聊天演示及可访问性", async () => {
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 812 });
      await page.goto(app);
      await noOverflow();
      await page.screenshot({
        path: `${artifacts}/home-mobile-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      await axe();
      await page.getByRole("button", { name: "打开演示客服" }).click();
      const chat = page.getByRole("region", { name: "客服窗口交互演示" });
      const rect = await chat.boundingBox();
      assert.ok(rect.x >= 0 && rect.x + rect.width <= width);
      await page
        .getByRole("button", { name: "能限制访客连续发图吗？", exact: true })
        .click();
      await noOverflow();
      await axe('[data-testid="appearance-demo"]');
    }
  });

  tenant = await db.tenant.create({
    data: {
      name: `样式测试 ${stamp}`,
      slug,
      status: "ACTIVE",
      defaults: {
        launcherStyle: "pill",
        launcherLabel: "初始按钮",
        primaryColor: "#135b46",
      },
      users: {
        create: {
          email,
          name: "样式测试管理员",
          role: "MERCHANT_ADMIN",
          passwordHash: await bcrypt.hash(password, 10),
        },
      },
    },
  });
  site = await db.site.create({
    data: {
      tenantId: tenant.id,
      name: `样式站点 ${stamp}`,
      slug,
      publicKey: slug,
      requireEmail: false,
      autoAssign: false,
      allowedOrigins: [],
    },
  });
  const login = await context.request.post(`${app}/api/auth/login`, {
    data: { email, password },
  });
  assert.equal(login.status(), 200, await login.text());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await test("商家样式与按钮文案保存，并由公开配置安全下发", async () => {
    await page.goto(`${app}${admin}/organization`);
    await page.getByRole("button", { name: "柔和底色", exact: true }).click();
    await page
      .getByLabel("悬浮按钮文案（最多 20 字）", { exact: true })
      .fill("联系小蜂");
    await page
      .getByRole("button", { name: "保存默认配置", exact: true })
      .click();
    await until(
      async () =>
        (await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } }))
          .defaults.launcherStyle === "soft",
      "merchant style saved",
    );
    await page.reload();
    assert.equal(
      await page
        .getByRole("button", { name: "柔和底色", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    const config = await (
      await context.request.get(
        `${app}/api/widget/config?key=${site.publicKey}`,
      )
    ).json();
    assert.equal(config.site.launcherStyle, "soft");
    assert.equal(config.site.launcherLabel, "联系小蜂");
    for (const internal of ["tenantId", "storageMB", "contactEmail"])
      assert.equal(JSON.stringify(config).includes(internal), false);
    await page.screenshot({
      path: `${artifacts}/branding-editor.png`,
      fullPage: true,
      animations: "disabled",
    });
  });
  await test("六种样式真实嵌入、打开关闭、未读角标及浅色文字对比度", async () => {
    for (const kind of kinds) {
      await db.site.update({
        where: { id: site.id },
        data: {
          widgetSettings: {
            launcherStyle: kind,
            primaryColor: kind === "soft" ? "#ffffff" : "#eab308",
          },
        },
      });
      const launcher = await embed();
      assert.equal(await launcher.getAttribute("data-launcher-style"), kind);
      const shape = await launcher.evaluate((el) => ({
        radius: el.style.borderRadius,
        width: el.getBoundingClientRect().width,
        text: el.querySelector(".bee-launcher-label").style.display,
      }));
      assert.equal(shape.radius, kind === "rounded" ? "18px" : "9999px");
      assert.equal(
        shape.text === "block",
        ["pill", "outline", "soft"].includes(kind),
      );
      if (["bubble", "rounded", "avatar"].includes(kind))
        assert.equal(shape.width, 58);
      await launcher.click();
      assert.equal(await launcher.getAttribute("aria-expanded"), "true");
      await page.locator(".beesupport-panel").waitFor({ state: "visible" });
      await launcher.click();
      await page.locator(".beesupport-panel").waitFor({ state: "hidden" });
      await page.evaluate(() => window.BeeSupport.setUnread(3));
      assert.equal(
        await launcher.locator(".beesupport-badge").innerText(),
        "3",
      );
      await axe(".beesupport-launcher");
      await launcher.screenshot({
        path: `${artifacts}/launcher-${kind}.png`,
        animations: "disabled",
      });
    }
  });
  await test("旧代码参数优先、左侧位置、窄屏与非法样式回退", async () => {
    await db.site.update({
      where: { id: site.id },
      data: {
        widgetSettings: { launcherStyle: "rounded", launcherLabel: "联系小蜂" },
      },
    });
    await page.setViewportSize({ width: 320, height: 700 });
    const launcher = await embed(
      `style=pill&position=left&color=%23ffffff&label=${encodeURIComponent("原代码按钮")}`,
    );
    await until(
      async () => (await launcher.getAttribute("aria-label")) === "原代码按钮",
      "legacy parameter applies",
    );
    await settle();
    assert.equal(await launcher.getAttribute("data-launcher-style"), "pill");
    assert.equal(
      await launcher.evaluate((el) => el.style.backgroundColor),
      "rgb(255, 255, 255)",
    );
    assert.equal(await launcher.evaluate((el) => el.style.left), "22px");
    await noOverflow();
    await launcher.click();
    await settle();
    const panel = await page.locator(".beesupport-panel").boundingBox();
    assert.equal(panel.width, 320);
    await axe(".beesupport-launcher");
    await embed(`style=avatar&label=${encodeURIComponent("原代码按钮")}`);
    assert.equal(
      await launcher.evaluate((el) => el.getBoundingClientRect().width),
      58,
    );
    assert.equal(
      await launcher.locator(".bee-launcher-label").isVisible(),
      false,
    );
    await embed("style=invalid");
    assert.equal(await launcher.getAttribute("data-launcher-style"), "rounded");
  });
  await test("品牌头像真实加载、失败回退、恢复继承与站点预览一致", async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const logo = `${app}/__brand-logo.png`;
    await page.route(logo, (route) =>
      route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1xkAAAAASUVORK5CYII=",
          "base64",
        ),
      }),
    );
    await db.site.update({
      where: { id: site.id },
      data: { widgetSettings: { launcherStyle: "avatar", logoUrl: logo } },
    });
    let launcher = await embed();
    await until(
      () =>
        launcher
          .locator("img")
          .evaluate((el) => el.complete && el.naturalWidth > 0),
      "brand avatar loaded",
    );
    assert.equal(await launcher.locator("img").isVisible(), true);
    await page.route(`${app}/__missing-logo.png`, (route) =>
      route.fulfill({ status: 404, body: "missing" }),
    );
    await db.site.update({
      where: { id: site.id },
      data: {
        widgetSettings: {
          launcherStyle: "avatar",
          logoUrl: `${app}/__missing-logo.png`,
        },
      },
    });
    launcher = await embed();
    await until(
      async () => !(await launcher.locator("img").isVisible()),
      "broken avatar falls back",
    );
    assert.equal(await launcher.locator(".bee-icon-headset").isVisible(), true);
    await db.site.update({
      where: { id: site.id },
      data: { widgetSettings: {} },
    });
    launcher = await embed();
    assert.equal(await launcher.getAttribute("data-launcher-style"), "soft");
    await page.goto(`${app}/preview?key=${site.publicKey}`);
    await until(
      async () =>
        (await page
          .locator(".beesupport-launcher")
          .getAttribute("aria-label")) === "联系小蜂",
      "site preview uses configured label",
    );
    assert.equal(
      await page
        .locator(".beesupport-launcher")
        .getAttribute("data-launcher-style"),
      "soft",
    );
    await page.screenshot({
      path: `${artifacts}/site-preview.png`,
      animations: "disabled",
    });
  });
  assert.deepEqual(errors, []);
  console.log(`${results.length} groups passed; no browser exceptions`);
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (tenant) {
    await db.site.deleteMany({ where: { tenantId: tenant.id } });
    await db.auditLog.deleteMany({ where: { tenantId: tenant.id } });
    await db.user.deleteMany({ where: { tenantId: tenant.id } });
    await db.tenant.delete({ where: { id: tenant.id } });
    if (site)
      await rm(`data/uploads/${site.id}`, { recursive: true, force: true });
  }
  await db.$disconnect();
  await writeFile(
    `${artifacts}/results.json`,
    JSON.stringify({ results, errors }, null, 2),
  );
}
