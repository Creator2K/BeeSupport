import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { waitForSettledPage } from "./browser-test-helpers.mjs";
import { useTestDatabase, restoreSetting } from "./test-environment.mjs";
useTestDatabase();
if (!process.env.TEST_APP_URL)
  throw new Error("TEST_APP_URL must select the authorized test app");
const APP = process.env.TEST_APP_URL.replace(/\/$/, ""),
  ADMIN = process.env.ADMIN_PATH || "/admin";
const { prisma: db } = await import("../src/lib/db.ts");
const { COLLECTION_KEY } = await import("../src/lib/collection.ts");
const stamp = randomUUID().replaceAll("-", "").slice(0, 12),
  password = `Test-${stamp}!`,
  artifacts = "/tmp/beesupport-collection-results";
const tenantIds = [],
  userIds = [],
  planIds = [],
  results = [],
  errors = [];
const saved = await db.setting.findUnique({ where: { key: COLLECTION_KEY } });
let browser,
  page,
  operatorPage,
  merchantPage,
  platform,
  a,
  b,
  plan,
  order,
  configAction,
  reportAction;
async function until(check, message, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
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
async function axe(p = page) {
  await waitForSettledPage(p);
  const result = await new AxeBuilder({ page: p })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
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
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
}
async function makePage(context) {
  const p = await context.newPage();
  p.setDefaultTimeout(20000);
  p.on("pageerror", (error) =>
    errors.push(`${new URL(p.url()).pathname}: ${error.message}`),
  );
  p.on("response", (response) => {
    if (response.status() >= 400 && response.url().includes("/_next/"))
      errors.push(`Asset ${response.status()} ${response.url()}`);
  });
  return p;
}
async function login(context, user) {
  const response = await context.request.post(`${APP}/api/auth/login`, {
    data: { email: user.email, password },
  });
  assert.equal(response.status(), 200, await response.text());
}
async function denied(response) {
  const body = await response.text();
  assert.ok(
    [403, 404].includes(response.status()) ||
      /NEXT_HTTP_ERROR_FALLBACK;404|This page could not be found/.test(body),
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
  const hash = await bcrypt.hash(password, 10);
  platform = await db.user.create({
    data: {
      tenantId: base.tenantId,
      name: "收款验收平台",
      email: `collection-ui-platform-${stamp}@test.local`,
      role: "ADMIN",
      passwordHash: hash,
    },
  });
  userIds.push(platform.id);
  const owners = [];
  for (const suffix of ["a", "b"]) {
    const tenant = await db.tenant.create({
      data: {
        slug: `collection-ui-${stamp}-${suffix}`,
        name: `收款验收 ${stamp} ${suffix}`,
        expiresAt: new Date(Date.now() + 40 * 86400000),
        users: {
          create: {
            name: `收款商家${suffix}`,
            email: `collection-ui-${stamp}-${suffix}@test.local`,
            role: "MERCHANT_ADMIN",
            passwordHash: hash,
          },
        },
      },
      include: { users: true },
    });
    tenantIds.push(tenant.id);
    owners.push(tenant.users[0]);
  }
  [a, b] = owners;
  plan = await db.subscriptionPlan.create({
    data: {
      name: `付款验收套餐 ${stamp}`,
      description: "测试专用，无需真实付款",
      priceCents: 1999,
      durationDays: 30,
      maxAgents: 5,
      maxSites: 3,
      monthlyConversations: 3000,
      storageMB: 100,
      active: true,
    },
  });
  planIds.push(plan.id);
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    headless: true,
  });
  const operator = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    merchant = await browser.newContext({
      viewport: { width: 1280, height: 1000 },
    }),
    other = await browser.newContext();
  await login(operator, platform);
  await login(merchant, a);
  await login(other, b);
  const qrUrl = `${APP}/__collection-qr-${stamp}.svg`;
  for (const context of [operator, merchant])
    await context.route(qrUrl, (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="white"/><path d="M24 24h64v64H24zM168 24h64v64h-64zM24 168h64v64H24zM120 120h48v48h-48zM184 184h48v48h-48z" fill="black"/></svg>',
      }),
    );
  operatorPage = await makePage(operator);
  merchantPage = await makePage(merchant);
  await test("平台收款配置、二维码预览、并发编辑和商家越权拦截", async () => {
    page = operatorPage;
    await page.goto(`${APP}${ADMIN}/collection`);
    const stale = await makePage(operator);
    await stale.goto(`${APP}${ADMIN}/collection`);
    await page.getByLabel("向商家展示收款说明", { exact: true }).check();
    await page
      .getByLabel("收款说明", { exact: true })
      .fill(`验收说明 ${stamp}\n测试收款方，请勿真实转账。`);
    await page
      .getByLabel("平台联系方式", { exact: true })
      .fill(`测试客服 ${stamp}`);
    await page
      .getByLabel("收款码图片地址（可选）", { exact: true })
      .fill(qrUrl);
    const request = page.waitForRequest(
      (r) => r.method() === "POST" && Boolean(r.headers()["next-action"]),
    );
    await page
      .getByRole("button", { name: "保存收款配置", exact: true })
      .click();
    configAction = (await request).headers()["next-action"];
    await until(
      async () =>
        (await db.setting.findUnique({ where: { key: COLLECTION_KEY } }))?.value
          .settings.contact === `测试客服 ${stamp}`,
      "configuration saved",
    );
    await until(
      () =>
        page
          .getByAltText("平台收款码", { exact: true })
          .evaluate((img) => img.complete && img.naturalWidth > 0),
      "QR preview loaded",
    );
    await axe();
    await page.setViewportSize({ width: 375, height: 812 });
    await axe();
    await page.screenshot({
      path: `${artifacts}/collection-mobile.png`,
      fullPage: true,
      animations: "disabled",
    });
    await stale.getByLabel("平台联系方式", { exact: true }).fill("旧窗口覆盖");
    await stale
      .getByRole("button", { name: "保存收款配置", exact: true })
      .click();
    await stale.getByRole("alert").filter({ hasText: "已更新" }).waitFor();
    await stale.close();
    await denied(await merchant.request.get(`${APP}${ADMIN}/collection`));
    const settings = await db.setting.findUniqueOrThrow({
      where: { key: COLLECTION_KEY },
    });
    await merchant.request.post(`${APP}${ADMIN}/collection`, {
      headers: {
        "next-action": configAction,
        "content-type": "text/plain;charset=UTF-8",
        origin: APP,
      },
      data: JSON.stringify([
        { ...settings.value.settings, contact: "越权篡改" },
        settings.value.revision,
      ]),
    });
    assert.equal(
      (await db.setting.findUniqueOrThrow({ where: { key: COLLECTION_KEY } }))
        .value.revision,
      settings.value.revision,
    );
  });
  await test("商家真实下单、付款反馈及修改，反馈后保持待审核且不延长有效期", async () => {
    page = merchantPage;
    await page.goto(`${APP}${ADMIN}/subscription`);
    await page
      .getByRole("region", { name: "人工收款说明" })
      .getByText(`测试客服 ${stamp}`, { exact: false })
      .waitFor();
    await page
      .locator("article")
      .filter({
        has: page.getByRole("heading", { name: plan.name, exact: true }),
      })
      .getByRole("button", { name: "选择套餐", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("checkbox").check();
    await dialog
      .getByRole("button", { name: "提交订单，等待平台确认", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    await until(async () => {
      order = await db.subscriptionOrder.findFirst({
        where: { tenantId: a.tenantId },
      });
      return Boolean(order);
    }, "order created");
    const before = await db.tenant.findUniqueOrThrow({
      where: { id: a.tenantId },
    });
    let card = page.locator(`[data-order-id="${order.id}"]`);
    await card
      .getByRole("button", { name: "我已付款，提交核对", exact: true })
      .click();
    await dialog
      .getByLabel("付款信息（平台可见）", { exact: true })
      .fill(`微信付款，验收流水 ${stamp}`);
    await dialog.getByRole("checkbox").check();
    await axe();
    const request = page.waitForRequest(
      (r) => r.method() === "POST" && Boolean(r.headers()["next-action"]),
    );
    await dialog
      .getByRole("button", { name: "提交付款信息", exact: true })
      .click();
    reportAction = (await request).headers()["next-action"];
    await dialog.waitFor({ state: "hidden" });
    await card
      .getByText("商家付款反馈（以平台实际到账为准）", { exact: true })
      .waitFor();
    let current = await db.subscriptionOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    assert.equal(current.status, "PENDING");
    assert.equal(current.paymentReportVersion, 1);
    assert.equal(
      (
        await db.tenant.findUniqueOrThrow({ where: { id: a.tenantId } })
      ).expiresAt.getTime(),
      before.expiresAt.getTime(),
    );
    await other.request.post(`${APP}${ADMIN}/subscription`, {
      headers: {
        "next-action": reportAction,
        "content-type": "text/plain;charset=UTF-8",
        origin: APP,
      },
      data: JSON.stringify([
        order.id,
        { note: "越权付款反馈", expectedVersion: 1, acknowledged: true },
      ]),
    });
    assert.equal(
      (
        await db.subscriptionOrder.findUniqueOrThrow({
          where: { id: order.id },
        })
      ).paymentReportVersion,
      1,
    );
    await card
      .getByRole("button", { name: "更新付款信息", exact: true })
      .click();
    await dialog
      .getByLabel("付款信息（平台可见）", { exact: true })
      .fill(`支付宝付款，更正验收信息 ${stamp}`);
    await dialog.getByRole("checkbox").check();
    await dialog
      .getByRole("button", { name: "提交付款信息", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    await card
      .getByText(`付款信息：支付宝付款，更正验收信息 ${stamp}`, { exact: true })
      .waitFor();
    await card.getByRole("button", { name: "取消订单", exact: true }).click();
    await dialog.getByText("取消订单不会自动退款", { exact: false }).waitFor();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.setViewportSize({ width: 375, height: 812 });
    await axe();
    await page.screenshot({
      path: `${artifacts}/merchant-mobile.png`,
      fullPage: true,
      animations: "disabled",
    });
  });
  await test("平台按付款反馈筛选、查看商家说明并核实收款后人工开通", async () => {
    page = operatorPage;
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(
      `${APP}${ADMIN}/orders?search=${encodeURIComponent(order.orderNo)}&status=PENDING&payment=reported`,
    );
    const card = page.locator(`[data-order-id="${order.id}"]`);
    await card
      .getByText(`付款信息：支付宝付款，更正验收信息 ${stamp}`, { exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel("付款反馈", { exact: true }).inputValue(),
      "reported",
    );
    await card.getByRole("button", { name: "确认开通", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByText(`商家付款信息（待核实）：支付宝付款，更正验收信息 ${stamp}`, {
        exact: true,
      })
      .waitFor();
    await dialog
      .getByLabel(/收款凭据 \/ 交易流水号/)
      .fill(`PRIVATE-COLLECTION-${stamp}`);
    await dialog.getByRole("checkbox").check();
    await dialog
      .getByLabel("处理说明（商家可见）", { exact: true })
      .fill(`已核实到账 ${stamp}`);
    await page.setViewportSize({ width: 375, height: 812 });
    await axe();
    await dialog
      .getByRole("button", { name: "确认收款并开通", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    await until(
      async () =>
        (
          await db.subscriptionOrder.findUniqueOrThrow({
            where: { id: order.id },
          })
        ).status === "CONFIRMED",
      "order confirmed",
    );
    assert.equal(
      await page.locator(`[data-order-id="${order.id}"]`).count(),
      0,
    );
    await page.goto(
      `${APP}${ADMIN}/orders?search=${encodeURIComponent(order.orderNo)}&status=CONFIRMED&payment=reported`,
    );
    await page
      .locator(`[data-order-id="${order.id}"]`)
      .getByText(`收款凭据：PRIVATE-COLLECTION-${stamp}`, { exact: true })
      .waitFor();
    await axe();
  });
  await test("商家审核结果通知、已读及隐私隔离，关闭收款展示保留配置", async () => {
    page = merchantPage;
    await page.goto(`${APP}${ADMIN}/notifications`);
    await page.waitForLoadState("networkidle");
    const notice = page.locator("article").filter({ hasText: order.orderNo });
    await notice
      .getByRole("heading", { name: "套餐订单已开通", exact: false })
      .waitFor();
    await notice.getByText(`已核实到账 ${stamp}`, { exact: false }).waitFor();
    assert.equal(
      (await page.content()).includes(`PRIVATE-COLLECTION-${stamp}`),
      false,
    );
    const readResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        Boolean(response.request().headers()["next-action"]),
    );
    await notice.getByRole("button", { name: "标为已读", exact: true }).click();
    assert.equal((await readResponse).status(), 200);
    await until(
      async () =>
        Boolean(
          (
            await db.accountNotice.findFirstOrThrow({
              where: { userId: a.id, dedupeKey: `order:${order.id}:CONFIRMED` },
            })
          ).readAt,
        ),
      "notice marked read in database",
    );
    await notice.getByText("已读", { exact: true }).waitFor();
    await axe();
    const response = await other.request.get(`${APP}${ADMIN}/notifications`);
    assert.equal((await response.text()).includes(order.orderNo), false);
    await page.goto(`${APP}${ADMIN}/subscription`);
    await page
      .locator(`[data-order-id="${order.id}"]`)
      .getByText("已开通", { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "更新付款信息", exact: true })
        .count(),
      0,
    );
    page = operatorPage;
    await page.goto(`${APP}${ADMIN}/collection`);
    await page.getByLabel("向商家展示收款说明", { exact: true }).uncheck();
    await page
      .getByRole("button", { name: "保存收款配置", exact: true })
      .click();
    await until(
      async () =>
        !(
          await db.setting.findUniqueOrThrow({ where: { key: COLLECTION_KEY } })
        ).value.settings.enabled,
      "display disabled",
    );
    assert.equal(
      (await db.setting.findUniqueOrThrow({ where: { key: COLLECTION_KEY } }))
        .value.settings.contact,
      `测试客服 ${stamp}`,
    );
    const disabledResponse = await merchantPage.reload();
    assert.equal(
      (await disabledResponse.text()).includes(`测试客服 ${stamp}`),
      false,
    );
    assert.equal(
      await merchantPage.getByRole("region", { name: "人工收款说明" }).count(),
      0,
    );
    await merchantPage
      .getByText("付款安排请联系平台。提交订单后由平台核对收款并开通。", {
        exact: true,
      })
      .waitFor();
  });
  assert.deepEqual(errors, []);
  console.log(
    `${results.length} collection browser groups passed; no page errors`,
  );
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await db.subscriptionOrder.deleteMany({
    where: { tenantId: { in: tenantIds } },
  });
  await db.auditLog.deleteMany({
    where: {
      OR: [{ tenantId: { in: tenantIds } }, { actorId: { in: userIds } }],
    },
  });
  await db.user.deleteMany({
    where: { OR: [{ tenantId: { in: tenantIds } }, { id: { in: userIds } }] },
  });
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await db.subscriptionPlan.deleteMany({ where: { id: { in: planIds } } });
  await restoreSetting(db, COLLECTION_KEY, saved);
  await db.$disconnect();
  await writeFile(
    `${artifacts}/results.json`,
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(
    "Owned collection fixtures removed; collection settings restored",
  );
}
