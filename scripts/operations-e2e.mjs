import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { waitForSettledPage } from "./browser-test-helpers.mjs";
import { useTestDatabase } from "./test-environment.mjs";
useTestDatabase();
if (!process.env.TEST_APP_URL) throw Error("Select authorized TEST_APP_URL");
const APP = process.env.TEST_APP_URL.replace(/\/$/, ""),
  ADMIN = process.env.ADMIN_PATH || "/admin",
  artifacts = "/tmp/beesupport-operations-results";
const { prisma: db } = await import("../src/lib/db.ts");
const { LEGACY_FEATURES, readFeatures, BASIC_FEATURES } =
  await import("../src/lib/entitlements.ts");
const stamp = randomUUID().replaceAll("-", "").slice(0, 12),
  password = `Test-${stamp}!`,
  tenantIds = [],
  userIds = [],
  planIds = [],
  results = [],
  errors = [];
let browser,
  page,
  operatorPage,
  merchantPage,
  platform,
  a,
  b,
  c,
  site,
  convs,
  otherConv,
  plan,
  order;
async function until(check, message, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error(`Timeout: ${message}`);
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
async function makePage(context) {
  const p = await context.newPage();
  p.setDefaultTimeout(20000);
  p.on("pageerror", (e) => errors.push(`${p.url()}: ${e.message}`));
  p.on("response", (r) => {
    if (r.status() >= 400 && r.url().includes("/_next/"))
      errors.push(`Asset ${r.status()} ${r.url()}`);
  });
  return p;
}
async function login(context, user, pass = password) {
  return context.request.post(`${APP}/api/auth/login`, {
    data: { email: user.email, password: pass },
  });
}
async function axe(p = page) {
  await waitForSettledPage(p);
  const scan = await new AxeBuilder({ page: p })
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
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
}
async function denied(response) {
  const body = await response.text();
  assert.ok(
    [403, 404].includes(response.status()) ||
      /NEXT_HTTP_ERROR_FALLBACK;404|This page could not be found/.test(body),
    body.slice(0, 200),
  );
}
async function conversation(owner, index) {
  const s = await db.site.create({
    data: {
      tenantId: owner.tenantId,
      name: `运营站点 ${index}`,
      slug: `ops-ui-${stamp}-${index}`,
      publicKey: `ops-ui-${stamp}-${index}`,
      autoAssign: false,
      widgetSettings: { footerText: `商家脚注 ${stamp}` },
    },
  });
  const visitor = await db.visitor.create({
    data: {
      siteId: s.id,
      email: `visitor-${stamp}-${index}@test.local`,
      name: `验收访客${index}`,
      localKey: randomUUID(),
    },
  });
  const conv = await db.conversation.create({
    data: {
      siteId: s.id,
      visitorId: visitor.id,
      assignedAgentId: owner.id,
      status: "OPEN",
      subject: `运营验收 ${index}`,
      messages: { create: { sender: "VISITOR", body: `验收咨询 ${index}` } },
    },
  });
  return { ...conv, site: s };
}
try {
  await mkdir(artifacts, { recursive: true });
  await until(async () => {
    try {
      return (await fetch(`${APP}/api/health/ready`)).ok;
    } catch {
      return false;
    }
  }, "readiness");
  const base = await db.user.findFirstOrThrow({
      where: { role: "ADMIN", active: true },
    }),
    hash = await bcrypt.hash(password, 10);
  platform = await db.user.create({
    data: {
      tenantId: base.tenantId,
      name: "运营浏览器验收",
      email: `ops-ui-platform-${stamp}@test.local`,
      role: "ADMIN",
      passwordHash: hash,
    },
  });
  userIds.push(platform.id);
  const owners = [];
  for (const suffix of ["a", "b"]) {
    const tenant = await db.tenant.create({
      data: {
        name: `运营浏览器 ${stamp} ${suffix}`,
        slug: `ops-ui-${stamp}-${suffix}`,
        features: LEGACY_FEATURES,
        expiresAt: new Date(Date.now() + 40 * 86400000),
        users: {
          create: {
            name: `运营商家${suffix}`,
            email: `ops-ui-${stamp}-${suffix}@test.local`,
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
  c = await db.user.create({
    data: {
      tenantId: b.tenantId,
      name: "限流验收",
      email: `ops-ui-fail-${stamp}@test.local`,
      role: "MERCHANT_ADMIN",
      passwordHash: hash,
    },
  });
  convs = [await conversation(a, 0), await conversation(a, 1)];
  otherConv = await conversation(b, 2);
  site = convs[0].site;
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    headless: true,
  });
  const operator = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    merchant = await browser.newContext({
      viewport: { width: 1280, height: 1000 },
    });
  assert.equal((await login(operator, platform)).status(), 200);
  assert.equal((await login(merchant, a)).status(), 200);
  operatorPage = await makePage(operator);
  merchantPage = await makePage(merchant);
  await test("真实套餐授权快照、人工开通及旧商家编辑页冲突保护", async () => {
    page = operatorPage;
    await page.goto(
      `${APP}${ADMIN}/merchants?search=${encodeURIComponent(`ops-ui-${stamp}-a`)}`,
    );
    await page
      .getByRole("button", { name: "审核 / 套餐 / 续期", exact: true })
      .click();
    const staleDialog = page.getByRole("dialog");
    const worker = await makePage(operator);
    await worker.goto(`${APP}${ADMIN}/plans`);
    await worker.getByRole("button", { name: "新增套餐", exact: true }).click();
    let dialog = worker.getByRole("dialog");
    await dialog
      .getByLabel("套餐名称", { exact: true })
      .fill(`运营授权套餐 ${stamp}`);
    await dialog.getByLabel("价格（元）", { exact: true }).fill("19.99");
    await dialog.getByLabel("上架，允许商家提交订单", { exact: true }).check();
    assert.equal(
      await dialog
        .getByLabel("AI 自动回复与客服草稿", { exact: true })
        .isChecked(),
      false,
    );
    await dialog.getByRole("button", { name: "保存套餐", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    plan = await db.subscriptionPlan.findFirstOrThrow({
      where: { name: `运营授权套餐 ${stamp}` },
    });
    planIds.push(plan.id);
    page = merchantPage;
    await page.goto(`${APP}${ADMIN}/subscription`);
    await page
      .locator("article")
      .filter({
        has: page.getByRole("heading", { name: plan.name, exact: true }),
      })
      .getByRole("button", { name: "选择套餐", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByText("未包含：整体访客画像统计", { exact: true })
      .waitFor();
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
    }, "submitted order");
    await worker.reload();
    await worker
      .locator("article")
      .filter({
        has: worker.getByRole("heading", { name: plan.name, exact: true }),
      })
      .getByRole("button", { name: "编辑套餐", exact: true })
      .click();
    dialog = worker.getByRole("dialog");
    for (const label of [
      "自定义底部品牌",
      "AI 自动回复与客服草稿",
      "整体访客画像统计",
    ])
      await dialog.getByLabel(label, { exact: true }).check();
    await dialog.getByRole("button", { name: "保存套餐", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await worker.goto(
      `${APP}${ADMIN}/orders?search=${encodeURIComponent(order.orderNo)}`,
    );
    await worker
      .locator(`[data-order-id="${order.id}"]`)
      .getByRole("button", { name: "确认开通", exact: true })
      .click();
    dialog = worker.getByRole("dialog");
    await dialog.getByLabel(/收款凭据 \/ 交易流水号/).fill(`OPS-UI-${stamp}`);
    await dialog.getByRole("checkbox").check();
    await dialog
      .getByRole("button", { name: "确认收款并开通", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    const renewed = await db.tenant.findUniqueOrThrow({
      where: { id: a.tenantId },
    });
    assert.deepEqual(readFeatures(renewed.features), BASIC_FEATURES);
    assert.equal(renewed.managementVersion, 1);
    page = operatorPage;
    await staleDialog
      .getByLabel("平台内部备注", { exact: true })
      .fill("旧页面不应覆盖续费");
    await staleDialog
      .getByRole("button", { name: "保存商家及套餐", exact: true })
      .click();
    await staleDialog
      .getByRole("alert")
      .filter({ hasText: "续费结果已更新" })
      .waitFor();
    assert.equal(
      (
        await db.tenant.findUniqueOrThrow({ where: { id: a.tenantId } })
      ).expiresAt.getTime(),
      renewed.expiresAt.getTime(),
    );
    await staleDialog
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await worker.close();
  });
  await test("套餐功能在公开配置和服务端生效，恢复授权后恢复既有配置", async () => {
    page = merchantPage;
    await page.goto(`${APP}${ADMIN}/visitors`);
    await page
      .getByText("整体访客画像统计未包含在当前套餐中。", { exact: true })
      .waitFor();
    await page.setViewportSize({ width: 375, height: 812 });
    await axe();
    const cfg = await merchant.request.get(
      `${APP}/api/widget/config?key=${site.publicKey}`,
    );
    assert.equal(cfg.status(), 200);
    assert.notEqual((await cfg.json()).site.footerText, `商家脚注 ${stamp}`);
    const ai = await merchant.request.post(
      `${APP}/api/agent/conversations/${convs[0].id}/suggest`,
      { data: {} },
    );
    assert.equal(ai.status(), 403);
    page = operatorPage;
    await page.reload();
    await page
      .getByRole("button", { name: "审核 / 套餐 / 续期", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    for (const label of [
      "自定义底部品牌",
      "AI 自动回复与客服草稿",
      "整体访客画像统计",
    ])
      await dialog.getByLabel(label, { exact: true }).check();
    await dialog
      .getByRole("button", { name: "保存商家及套餐", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    const cfg2 = await merchant.request.get(
      `${APP}/api/widget/config?key=${site.publicKey}`,
    );
    assert.equal((await cfg2.json()).site.footerText, `商家脚注 ${stamp}`);
    page = merchantPage;
    await page.reload();
    await page
      .getByRole("heading", { name: "访客画像", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByText("整体访客画像统计未包含在当前套餐中。", { exact: true })
        .count(),
      0,
    );
    await page.goto(`${APP}${ADMIN}/organization`);
    await page.getByText("当前套餐功能", { exact: true }).waitFor();
    await axe();
  });
  await test("客服草稿刷新恢复、会话隔离、发送清理及退出账号隔离", async () => {
    page = merchantPage;
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(`${APP}/agent?c=${convs[0].id}`);
    const composer = page.getByPlaceholder(
        "输入消息，Enter 发送，Shift+Enter 换行",
        { exact: true },
      ),
      prefix = `beesupport:drafts:v1:${encodeURIComponent(a.id)}:`;
    await composer.fill(`第一段草稿 ${stamp}`);
    await page.reload();
    await until(
      async () => (await composer.inputValue()) === `第一段草稿 ${stamp}`,
      "first draft restored",
    );
    await page.goto(`${APP}/agent?c=${convs[1].id}`);
    await until(
      async () => !(await composer.isDisabled()),
      "draft store hydrated",
    );
    assert.equal(await composer.inputValue(), "");
    await composer.fill(`第二段草稿 ${stamp}`);
    await page.goto(`${APP}/agent?c=${convs[0].id}`);
    await until(
      async () => (await composer.inputValue()) === `第一段草稿 ${stamp}`,
      "conversation drafts isolated",
    );
    await composer.press("Enter");
    await until(
      async () =>
        (await db.message.count({
          where: {
            conversationId: convs[0].id,
            body: `第一段草稿 ${stamp}`,
            sender: "AGENT",
          },
        })) === 1,
      "message sent",
    );
    await until(
      () =>
        page.evaluate(
          (key) => localStorage.getItem(key) === null,
          prefix + encodeURIComponent(convs[0].id),
        ),
      "sent draft removed",
    );
    await page.getByRole("button", { name: /^(在线|离线|离开)$/ }).click();
    await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
    await page.waitForURL(`${APP}/login`);
    assert.equal(
      await page.evaluate(
        (p) =>
          Object.keys(localStorage).filter((key) => key.startsWith(p)).length,
        prefix,
      ),
      0,
    );
    assert.equal((await login(merchant, b)).status(), 200);
    await page.goto(`${APP}/agent?c=${otherConv.id}`);
    await until(
      async () => !(await composer.isDisabled()),
      "second account hydrated",
    );
    assert.equal(await composer.inputValue(), "");
    await composer.fill(`B 账号草稿 ${stamp}`);
    await page.reload();
    await until(
      async () => (await composer.inputValue()) === `B 账号草稿 ${stamp}`,
      "second account draft restored",
    );
  });
  await test("平台运营看板周期筛选、真实数据和手机布局，商家不能读取", async () => {
    page = operatorPage;
    await page.goto(`${APP}${ADMIN}/operations`);
    await page
      .getByRole("heading", { name: "平台运营看板", exact: true })
      .waitFor();
    await page.getByText("已确认订单金额", { exact: true }).waitFor();
    await axe();
    await page.getByLabel("统计周期", { exact: true }).selectOption("90");
    await page
      .getByRole("button", { name: "查看运营数据", exact: true })
      .click();
    await page.waitForURL(/days=90/);
    await page.setViewportSize({ width: 375, height: 812 });
    await axe();
    await page.getByText("查看每日数据", { exact: true }).click();
    await axe();
    await page.screenshot({
      path: `${artifacts}/operations-mobile.png`,
      fullPage: true,
      animations: "disabled",
    });
    await denied(await merchant.request.get(`${APP}${ADMIN}/operations`));
  });
  await test("同一出口超过二十次正常登录可用，失败次数达到上限后仍受保护", async () => {
    const loginContext = await browser.newContext();
    for (let i = 0; i < 25; i++)
      assert.equal((await login(loginContext, a)).status(), 200);
    for (let i = 0; i < 10; i++)
      assert.equal(
        (await login(loginContext, c, "wrong-password")).status(),
        401,
      );
    const blocked = await login(loginContext, c);
    assert.equal(blocked.status(), 429);
    assert.ok(Number(blocked.headers()["retry-after"]) > 0);
    assert.equal((await login(loginContext, b)).status(), 200);
    await loginContext.close();
  });
  assert.deepEqual(errors, []);
  console.log(
    `${results.length} operations browser groups passed; no page errors`,
  );
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await db.subscriptionOrder.deleteMany({
    where: { tenantId: { in: tenantIds } },
  });
  await db.site.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { tenantId: { in: tenantIds } },
        { actorId: { in: userIds } },
        { actorName: { in: [a?.email, b?.email, c?.email].filter(Boolean) } },
      ],
    },
  });
  await db.user.deleteMany({
    where: { OR: [{ tenantId: { in: tenantIds } }, { id: { in: userIds } }] },
  });
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await db.subscriptionPlan.deleteMany({ where: { id: { in: planIds } } });
  await db.$disconnect();
  await writeFile(
    `${artifacts}/results.json`,
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log("Owned operations fixtures removed");
}
