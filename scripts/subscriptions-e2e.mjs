import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { useTestDatabase } from "./test-environment.mjs";
useTestDatabase();
if (!process.env.TEST_APP_URL) throw new Error("TEST_APP_URL is required");
const APP = process.env.TEST_APP_URL.replace(/\/$/, "");
const ADMIN = process.env.ADMIN_PATH || "/admin";
const artifacts = "/tmp/beesupport-subscriptions-results";
const stamp = randomUUID().replaceAll("-", "").slice(0, 14);
const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();
const tenants = [],
  plans = [],
  results = [],
  errors = [];
let browser, page, adminPage, plan, submitAction, decideAction, firstOrder;
const password = `Billing-${stamp}!`;
async function until(check, reason, timeout = 15000) {
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
    console.log(`PASS: ${name}`);
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error.stack });
    await page
      ?.screenshot({ path: `${artifacts}/failure.png`, fullPage: true })
      .catch(() => {});
    throw error;
  }
}
async function replay(context, action, args, path = "/subscription") {
  return context.request.post(`${APP}${ADMIN}${path}`, {
    headers: {
      "next-action": action,
      "content-type": "text/plain;charset=UTF-8",
      origin: APP,
    },
    data: JSON.stringify(args),
  });
}
async function actionRequest(p, click) {
  const request = p.waitForRequest(
    (req) => req.method() === "POST" && !!req.headers()["next-action"],
  );
  await click();
  const req = await request;
  return { id: req.headers()["next-action"], body: req.postData() };
}
try {
  await mkdir(artifacts, { recursive: true });
  await until(
    async () => {
      try {
        return (await fetch(`${APP}/api/health/ready`)).ok;
      } catch {
        return false;
      }
    },
    "readiness",
    30000,
  );
  for (const suffix of ["a", "b"]) {
    const tenant = await db.tenant.create({
      data: {
        name: `续费浏览器 ${stamp} ${suffix}`,
        slug: `bill-ui-${stamp}-${suffix}`,
        expiresAt: new Date(Date.now() + 5 * 86400000),
        users: {
          create: {
            name: `商家 ${suffix}`,
            email: `bill-ui-${stamp}-${suffix}@test.local`,
            passwordHash: await bcrypt.hash(password, 10),
            role: "MERCHANT_ADMIN",
          },
        },
      },
      include: { users: true },
    });
    tenants.push(tenant);
  }
  await writeFile(
    `${artifacts}/pending-fixtures.json`,
    JSON.stringify({ tenantIds: tenants.map((t) => t.id), planIds: plans }),
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
  for (const [context, email, pass] of [
    [
      platform,
      process.env.SEED_ADMIN_EMAIL || "admin@beesupport.local",
      process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!",
    ],
    [merchant, tenants[0].users[0].email, password],
    [other, tenants[1].users[0].email, password],
  ]) {
    const response = await context.request.post(`${APP}/api/auth/login`, {
      data: { email, password: pass },
    });
    assert.equal(response.status(), 200, await response.text());
  }
  adminPage = await platform.newPage();
  page = await merchant.newPage();
  for (const p of [adminPage, page]) {
    p.setDefaultTimeout(15000);
    p.on("pageerror", (error) => errors.push(error.message));
  }
  await test("平台创建并发布真实可选套餐，金额按分保存", async () => {
    await adminPage.goto(`${APP}${ADMIN}/plans`);
    await adminPage
      .getByRole("button", { name: "新增套餐", exact: true })
      .click();
    const dialog = adminPage.getByRole("dialog");
    await dialog
      .getByLabel("套餐名称", { exact: true })
      .fill(`验收套餐 ${stamp}`);
    await dialog.getByLabel("价格（元）", { exact: true }).fill("19.99");
    await dialog.getByLabel("上架，允许商家提交订单", { exact: true }).check();
    await dialog.getByRole("button", { name: "保存套餐", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    plan = await db.subscriptionPlan.findFirstOrThrow({
      where: { name: `验收套餐 ${stamp}` },
    });
    plans.push(plan.id);
    await writeFile(
      `${artifacts}/pending-fixtures.json`,
      JSON.stringify({ tenantIds: tenants.map((t) => t.id), planIds: plans }),
    );
    assert.equal(plan.priceCents, 1999);
    assert.equal(plan.active, true);
  });
  await test("商家下单、丢失响应重试不重复创建，跨角色套餐修改被拒绝", async () => {
    await page.goto(`${APP}${ADMIN}/subscription`);
    await page
      .locator("article")
      .filter({ hasText: plan.name })
      .getByRole("button", { name: "选择套餐" })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("我已确认本次价格、额度及有效期规则", { exact: true })
      .check();
    await dialog
      .getByLabel("订单备注（选填）", { exact: true })
      .fill("浏览器验收订单");
    const submitted = await actionRequest(page, () =>
      dialog
        .getByRole("button", { name: "提交订单，等待平台确认", exact: true })
        .click(),
    );
    submitAction = submitted.id;
    await dialog.waitFor({ state: "hidden" });
    firstOrder = await db.subscriptionOrder.findFirstOrThrow({
      where: { tenantId: tenants[0].id },
    });
    await replay(merchant, submitAction, JSON.parse(submitted.body));
    assert.equal(
      await db.subscriptionOrder.count({ where: { tenantId: tenants[0].id } }),
      1,
    );
    await page.getByText("待平台确认", { exact: true }).waitFor();
    const denied = await merchant.request.get(`${APP}${ADMIN}/plans`);
    const body = await denied.text();
    assert.ok(
      denied.status() === 404 ||
        /NEXT_HTTP_ERROR_FALLBACK;404|This page could not be found/.test(body),
    );
    assert.equal(
      (
        await db.tenant.findUnique({ where: { id: tenants[0].id } })
      ).expiresAt.getTime(),
      tenants[0].expiresAt.getTime(),
    );
  });
  await test("修改并下架套餐不改已提交订单，平台核对收款后只按原报价开通一次", async () => {
    await adminPage.goto(`${APP}${ADMIN}/plans`);
    await adminPage
      .locator("article")
      .filter({ hasText: plan.name })
      .getByRole("button", { name: "编辑套餐" })
      .click();
    const edit = adminPage.getByRole("dialog");
    await edit.getByLabel("价格（元）", { exact: true }).fill("99.99");
    await edit.getByLabel("有效天数", { exact: true }).fill("60");
    await edit.getByLabel("上架，允许商家提交订单", { exact: true }).uncheck();
    await edit.getByRole("button", { name: "保存套餐", exact: true }).click();
    await edit.waitFor({ state: "hidden" });
    assert.equal(
      (await db.subscriptionOrder.findUnique({ where: { id: firstOrder.id } }))
        .priceCents,
      1999,
    );
    await adminPage.goto(`${APP}${ADMIN}/orders?search=${firstOrder.orderNo}`);
    const card = adminPage.locator(`[data-order-id="${firstOrder.id}"]`);
    await card.getByRole("button", { name: "确认开通", exact: true }).click();
    const dialog = adminPage.getByRole("dialog");
    await dialog
      .getByLabel(/收款凭据 \/ 交易流水号/)
      .fill(`UI-RECEIPT-${stamp}`);
    await dialog
      .getByLabel("我已核对收款，或确认本订单获准免费开通", { exact: true })
      .check();
    await dialog
      .getByLabel("处理说明（商家可见）", { exact: true })
      .fill("已核验，通过验收");
    const confirmed = await actionRequest(adminPage, () =>
      dialog
        .getByRole("button", { name: "确认收款并开通", exact: true })
        .click(),
    );
    decideAction = confirmed.id;
    await dialog.waitFor({ state: "hidden" });
    await replay(platform, decideAction, JSON.parse(confirmed.body), "/orders");
    const tenant = await db.tenant.findUniqueOrThrow({
      where: { id: tenants[0].id },
    });
    assert.equal(
      tenant.expiresAt.getTime(),
      tenants[0].expiresAt.getTime() + 30 * 86400000,
    );
    assert.equal(
      await db.auditLog.count({
        where: {
          targetId: firstOrder.id,
          action: "subscription.order.confirmed",
        },
      }),
      1,
    );
    await page.goto(`${APP}${ADMIN}/subscription`);
    await page.getByText("已开通", { exact: true }).waitFor();
    assert.equal((await page.content()).includes(`UI-RECEIPT-${stamp}`), false);
    await page
      .getByText("处理说明：已核验，通过验收", { exact: true })
      .waitFor();
  });
  await test("订单金额及额度由服务端决定，商家无法审核或取消其他商家的订单", async () => {
    await db.subscriptionPlan.update({
      where: { id: plan.id },
      data: { active: true },
    });
    const current = await db.subscriptionPlan.findUniqueOrThrow({
      where: { id: plan.id },
    });
    await replay(other, submitAction, [
      {
        planId: current.id,
        expectedVersion: current.updatedAt.toISOString(),
        clientRequestId: randomUUID(),
        note: "恶意参数验收",
        priceCents: 0,
        maxAgents: 99999,
      },
    ]);
    const bo = await db.subscriptionOrder.findFirstOrThrow({
      where: { tenantId: tenants[1].id },
    });
    assert.equal(bo.priceCents, 9999);
    assert.equal(bo.maxAgents, current.maxAgents);
    const args = [
      bo.id,
      {
        decision: "CONFIRMED",
        note: "越权",
        paymentReference: `BAD-${stamp}`,
        acknowledged: true,
      },
    ];
    await replay(merchant, decideAction, args);
    await replay(merchant, decideAction, [
      bo.id,
      {
        decision: "CANCELLED",
        note: "越权取消",
        paymentReference: "",
        acknowledged: false,
      },
    ]);
    assert.equal(
      (await db.subscriptionOrder.findUnique({ where: { id: bo.id } })).status,
      "PENDING",
    );
    const otherPage = await other.newPage();
    await otherPage.goto(`${APP}${ADMIN}/subscription`);
    assert.equal(
      (await otherPage.content()).includes(firstOrder.orderNo),
      false,
    );
    await otherPage
      .locator(`[data-order-id="${bo.id}"]`)
      .getByRole("button", { name: "取消订单", exact: true })
      .click();
    await otherPage
      .getByRole("dialog")
      .getByRole("button", { name: "确认取消订单", exact: true })
      .click();
    await otherPage.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(
      (await db.subscriptionOrder.findUnique({ where: { id: bo.id } })).status,
      "CANCELLED",
    );
    await otherPage.close();
  });
  await test("拒绝原因反馈给商家，撤销及重新下单流程可用", async () => {
    await page.goto(`${APP}${ADMIN}/subscription`);
    await page
      .locator("article")
      .filter({ hasText: plan.name })
      .getByRole("button", { name: "选择套餐" })
      .click();
    const submit = page.getByRole("dialog");
    await submit
      .getByLabel("我已确认本次价格、额度及有效期规则", { exact: true })
      .check();
    await submit
      .getByRole("button", { name: "提交订单，等待平台确认", exact: true })
      .click();
    await submit.waitFor({ state: "hidden" });
    const second = await db.subscriptionOrder.findFirstOrThrow({
      where: { tenantId: tenants[0].id, status: "PENDING" },
    });
    await adminPage.goto(`${APP}${ADMIN}/orders?search=${second.orderNo}`);
    await adminPage
      .locator(`[data-order-id="${second.id}"]`)
      .getByRole("button", { name: "拒绝订单", exact: true })
      .click();
    const dialog = adminPage.getByRole("dialog");
    await dialog
      .getByLabel("拒绝原因（商家可见，必填）", { exact: true })
      .fill("验收：请补充付款资料");
    await dialog
      .getByRole("button", { name: "提交拒绝原因", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    await page.goto(`${APP}${ADMIN}/subscription`);
    await page
      .getByText("处理说明：验收：请补充付款资料", { exact: true })
      .waitFor();
    assert.equal(
      (await db.subscriptionOrder.findUnique({ where: { id: second.id } }))
        .status,
      "REJECTED",
    );
  });
  await test("临近到期提示、服务端商家搜索及 PC/手机页面验证", async () => {
    await db.tenant.update({
      where: { id: tenants[0].id },
      data: { expiresAt: new Date(Date.now() + 3 * 86400000) },
    });
    await page.goto(`${APP}${ADMIN}/organization`);
    await page
      .getByText("服务将在 7 天内到期，建议提前提交续费订单。", { exact: true })
      .waitFor();
    await adminPage.goto(`${APP}${ADMIN}/merchants?search=${stamp}`);
    await adminPage
      .getByRole("heading", { name: "商家与套餐", exact: true })
      .waitFor();
    assert.equal(await adminPage.locator("article").count(), 2);
    await adminPage
      .getByRole("button", { name: "搜索商家", exact: true })
      .click();
    await adminPage.waitForURL(/search=/);
    for (const [p, path] of [
      [page, "/subscription"],
      [adminPage, "/plans"],
      [adminPage, "/orders"],
    ]) {
      await p.goto(`${APP}${ADMIN}${path}`);
      await p.locator("h1").waitFor();
      for (const width of [1440, 390]) {
        await p.setViewportSize({ width, height: 900 });
        assert.equal(
          await p.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
        );
        await p.evaluate(async () => {
          await Promise.all(
            document
              .getAnimations()
              .filter((a) => Number.isFinite(a.effect?.getTiming().iterations))
              .map((a) => a.finished.catch(() => {})),
          );
        });
        const scan = await new AxeBuilder({ page: p })
          .withTags(["wcag2a", "wcag2aa"])
          .analyze();
        assert.deepEqual(
          scan.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.map((n) => ({
              target: n.target,
              failureSummary: n.failureSummary,
            })),
          })),
          [],
        );
        await p.screenshot({
          path: `${artifacts}/${path.slice(1)}-${width}.png`,
          fullPage: true,
          animations: "disabled",
        });
      }
    }
    assert.deepEqual(errors, []);
  });
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await db.subscriptionOrder.deleteMany({
    where: { tenantId: { in: tenants.map((t) => t.id) } },
  });
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { tenantId: { in: tenants.map((t) => t.id) } },
        { targetType: "SubscriptionPlan", targetId: { in: plans } },
      ],
    },
  });
  await db.subscriptionPlan.deleteMany({ where: { id: { in: plans } } });
  await db.user.deleteMany({
    where: { tenantId: { in: tenants.map((t) => t.id) } },
  });
  await db.tenant.deleteMany({
    where: { id: { in: tenants.map((t) => t.id) } },
  });
  await db.$disconnect();
  await writeFile(
    `${artifacts}/results.json`,
    JSON.stringify(results, null, 2),
  );
  await rm(`${artifacts}/pending-fixtures.json`, { force: true });
  console.log(
    `${results.filter((r) => r.ok).length}/${results.length} subscription browser groups passed; owned fixtures removed`,
  );
}
