import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import bcrypt from "bcryptjs";
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";

import { useTestDatabase } from "./test-environment.mjs";

useTestDatabase();
if (!process.env.TEST_APP_URL)
  throw new Error("TEST_APP_URL must point to an isolated BeeSupport instance");
const APP = process.env.TEST_APP_URL.replace(/\/$/, "");
const ADMIN_PATH = (process.env.ADMIN_PATH ?? "/admin").replace(/\/+$/, "") || "/admin";
const artifacts = resolve(
  process.env.AI_POLICY_E2E_ARTIFACTS ?? "test-results/ai-policy/browser",
);

test("merchant AI policy page saves an isolated tenant policy", { timeout: 60_000 }, async () => {
  await mkdir(artifacts, { recursive: true });
  const db = new PrismaClient();
  const stamp = randomUUID();
  const email = `ai-policy-${stamp}@test.local`;
  const password = "TemporaryAiPolicy123!";
  let tenant;
  let browser;
  const consoleErrors = [];
  try {
    tenant = await db.tenant.create({
      data: {
        name: "AI Policy Browser",
        slug: stamp,
        planName: "Test",
        features: { ai: true, removeBranding: true, advancedAnalytics: true },
      },
    });
    const site = await db.site.create({
      data: { tenantId: tenant.id, name: "Policy Main Site", slug: stamp },
    });
    await db.user.create({
      data: {
        tenantId: tenant.id,
        email,
        name: "AI Policy Admin",
        passwordHash: await bcrypt.hash(password, 10),
        role: "MERCHANT_ADMIN",
        active: true,
      },
    });

    const login = await fetch(`${APP}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(login.ok, true, `login failed: HTTP ${login.status}`);
    const setCookie = login.headers.getSetCookie?.()[0] ?? login.headers.get("set-cookie");
    assert.ok(setCookie, "login did not return a session cookie");
    const value = setCookie.split(";")[0].slice("beesupport_session=".length);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "zh-CN",
    });
    await context.addCookies([
      { name: "beesupport_session", value, url: APP, httpOnly: true, sameSite: "Lax" },
    ]);
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.goto(`${APP}${ADMIN_PATH}/ai`, { waitUntil: "networkidle" });
    await assertVisible(page, "商家 AI 策略");
    await page.getByRole("combobox", { name: "生效范围" }).click();
    await assertVisible(page, "站点 · Policy Main Site");
    await page.keyboard.press("Escape");
    await assertVisible(page, "本月 AI 用量");

    await page.locator("#merchant-ai-name").fill("E2E Merchant Assistant");
    await page.getByRole("button", { name: "保存策略" }).click();

    const deadline = Date.now() + 15_000;
    let saved;
    while (Date.now() < deadline) {
      saved = await db.aiPolicy.findUnique({ where: { tenantId: tenant.id } });
      if (saved?.assistantName === "E2E Merchant Assistant") break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.equal(saved?.assistantName, "E2E Merchant Assistant");
    assert.equal(saved?.tenantId, tenant.id);
    assert.ok(site.id);

    await page.screenshot({ path: resolve(artifacts, "merchant-ai-policy.png"), fullPage: true });
    await writeFile(
      resolve(artifacts, "merchant-ai-policy.json"),
      `${JSON.stringify(
        {
          status: "passed",
          route: `${ADMIN_PATH}/ai`,
          tenantId: tenant.id,
          policyVersion: saved.version,
          assistantName: saved.assistantName,
          consoleErrors,
        },
        null,
        2,
      )}\n`,
    );
    assert.deepEqual(
      consoleErrors.filter((message) => !message.includes("favicon")),
      [],
    );
  } catch (error) {
    if (browser) {
      const pages = browser.contexts().flatMap((context) => context.pages());
      if (pages[0])
        await pages[0]
          .screenshot({ path: resolve(artifacts, "merchant-ai-policy-failure.png"), fullPage: true })
          .catch(() => undefined);
    }
    throw error;
  } finally {
    await browser?.close();
    if (tenant) {
      await db.site.deleteMany({ where: { tenantId: tenant.id } });
      await db.user.deleteMany({ where: { tenantId: tenant.id } });
      // Signing in and saving the policy write audit rows; the tenant cannot be deleted while they exist.
      await db.auditLog.deleteMany({ where: { tenantId: tenant.id } });
      await db.tenant.deleteMany({ where: { id: tenant.id } });
    }
    await db.$disconnect();
  }
});

async function assertVisible(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible" });
}
