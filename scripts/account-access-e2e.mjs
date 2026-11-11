import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { waitForSettledPage } from "./browser-test-helpers.mjs";
import { useTestDatabase } from "./test-environment.mjs";
useTestDatabase();
if (!process.env.TEST_APP_URL) throw Error("Select authorized TEST_APP_URL");
const stamp = randomUUID().replaceAll("-", "").slice(0, 12);
const databaseName = `beesupport_account_${stamp}`;
const sourceUrl = process.env.DATABASE_URL;
const databaseUrl = new URL(sourceUrl);
databaseUrl.pathname = `/${databaseName}`;
const appUrl = new URL(process.env.TEST_APP_URL);
appUrl.port = String(Number(process.env.ACCOUNT_E2E_PORT || 3002));
const APP = appUrl.origin,
  ADMIN = process.env.ADMIN_PATH || "/admin";
const artifacts =
    process.env.ACCOUNT_E2E_ARTIFACTS || join(tmpdir(), "beesupport-account-results"),
  password = `Test-${stamp}!`;
const adminDb = new PrismaClient({ datasourceUrl: sourceUrl });
const db = new PrismaClient({ datasourceUrl: databaseUrl.toString() });
const inbox = [],
  errors = [],
  results = [],
  sockets = new Set();
let created = false,
  child,
  browser,
  page,
  platformPage,
  merchantPage;
await mkdir(artifacts, { recursive: true });

// Minimal local SMTP sink: accepts messages into memory and never relays them.
const smtp = createServer((socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.setEncoding("utf8");
  socket.write("220 isolated.test ESMTP\r\n");
  let buffer = "",
    data = null,
    recipients = [];
  socket.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n"),
        line = buffer.slice(0, index).replace(/\r$/, "");
      buffer = buffer.slice(index + 1);
      if (data) {
        if (line === ".") {
          inbox.push({ recipients: [...recipients], raw: data.join("\r\n") });
          data = null;
          recipients = [];
          socket.write("250 accepted locally\r\n");
        } else data.push(line.startsWith("..") ? line.slice(1) : line);
      } else if (/^EHLO|^HELO/i.test(line))
        socket.write("250-isolated.test\r\n250 SIZE 1000000\r\n");
      else if (/^MAIL FROM:/i.test(line)) {
        recipients = [];
        socket.write("250 OK\r\n");
      } else if (/^RCPT TO:/i.test(line)) {
        recipients.push(line.match(/<([^>]+)>/)?.[1]?.toLowerCase());
        socket.write("250 OK\r\n");
      } else if (/^DATA$/i.test(line)) {
        data = [];
        socket.write("354 send message\r\n");
      } else if (/^QUIT$/i.test(line)) socket.end("221 goodbye\r\n");
      else socket.write("250 OK\r\n");
    }
  });
});
async function until(check, label, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error(`Timeout: ${label}`);
}
function decodeMail(raw) {
  const separator = raw.indexOf("\r\n\r\n"),
    headers = raw.slice(0, separator),
    body = raw.slice(separator + 4);
  return /Content-Transfer-Encoding: base64/i.test(headers)
    ? Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8")
    : body
        .replace(/=\r?\n/g, "")
        .replace(/=([0-9A-F]{2})/gi, (_, hex) =>
          String.fromCharCode(parseInt(hex, 16)),
        );
}
async function mailLink(email, path, after = 0) {
  let found;
  await until(() => {
    found = inbox
      .slice(after)
      .findLast(
        (mail) =>
          mail.recipients.includes(email) &&
          decodeMail(mail.raw).includes(`${path}#token=`),
      );
    return Boolean(found);
  }, `mail ${path}`);
  const url = decodeMail(found.raw).match(
    new RegExp(`http[^\\s]+${path}#token=([a-f0-9]{64})`),
  )?.[0];
  assert.ok(url, "Mail must contain a complete fragment link");
  assert.equal(new URL(url).origin, APP);
  return url;
}
function rawToken(url) {
  return new URLSearchParams(new URL(url).hash.slice(1)).get("token");
}
async function makePage(context) {
  const p = await context.newPage();
  p.setDefaultTimeout(15000);
  p.on("pageerror", (e) =>
    errors.push(`${new URL(p.url()).pathname}: ${e.message}`),
  );
  return p;
}
async function login(context, user, pass = password) {
  return context.request.post(`${APP}/api/auth/login`, {
    data: { email: user.email, password: pass },
  });
}
async function axe(p) {
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
    await p.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
    "No horizontal overflow",
  );
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
try {
  await new Promise((resolve, reject) => {
    smtp.once("error", reject);
    smtp.listen(0, "127.0.0.1", resolve);
  });
  await adminDb.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  created = true;
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
      stdio: "pipe",
    },
  );
  const platform = await db.user.create({
    data: {
      name: "隔离验收平台",
      email: `platform-${stamp}@test.local`,
      role: "ADMIN",
      passwordHash: await bcrypt.hash(password, 10),
    },
  });
  const team = await db.tenant.create({
    data: {
      name: "隔离邀请团队",
      slug: `team-${stamp}`,
      maxAgents: 3,
      users: {
        create: {
          name: "邀请管理员",
          email: `team-${stamp}@test.local`,
          role: "MERCHANT_ADMIN",
          passwordHash: await bcrypt.hash(password, 10),
        },
      },
      sites: { create: { name: "邀请验收站点", slug: `site-${stamp}` } },
    },
    include: { users: true, sites: true },
  });
  const merchant = team.users[0];
  const serverLog = createWriteStream(`${artifacts}/server.log`);
  child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: databaseUrl.toString(),
      REDIS_URL: "",
      SMTP_HOST: "",
      WECHATBOT_ENABLED: "false",
      WECHATBOT_STORAGE_DIR: `${artifacts}/wechat-${stamp}`,
      UPLOAD_DIR: `${artifacts}/uploads-${stamp}`,
      APP_URL: APP,
      PORT: appUrl.port,
      BIND_HOST: "0.0.0.0",
      NEXT_DIST_DIR:
        process.env.ACCOUNT_E2E_BUILD ||
        process.env.NEXT_DIST_DIR ||
        ".next-account-access-release",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(serverLog);
  child.stderr.pipe(serverLog);
  await until(
    async () => {
      if (child.exitCode !== null)
        throw Error(`Preview exited ${child.exitCode}; inspect server.log`);
      try {
        return (await fetch(`${APP}/api/health/ready`)).ok;
      } catch {
        return false;
      }
    },
    "isolated preview startup",
    45000,
  );
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    headless: true,
    args: ["--no-sandbox"],
  });
  const publicContext = await browser.newContext(),
    platformContext = await browser.newContext(),
    merchantContext = await browser.newContext();
  page = await makePage(publicContext);
  platformPage = await makePage(platformContext);
  merchantPage = await makePage(merchantContext);

  if (
    process.env.E2E_REPORTING === "true" ||
    process.env.E2E_CANNED === "true" ||
    process.env.E2E_FOLLOWUPS === "true" ||
    process.env.E2E_AUTO_FOLLOWUPS === "true" ||
    process.env.E2E_UNANSWERED === "true" ||
    process.env.E2E_EFFICIENCY === "true"
  ) {
    assert.equal((await login(platformContext, platform)).status(), 200);
    assert.equal((await login(merchantContext, merchant)).status(), 200);
  } else if (process.env.E2E_DELIVERIES === "true") {
    await db.setting.create({
      data: {
        key: "smtp",
        value: {
          host: "127.0.0.1",
          port: smtp.address().port,
          secure: false,
          from: "noreply@test.local",
        },
      },
    });
    assert.equal((await login(platformContext, platform)).status(), 200);
    assert.equal((await login(merchantContext, merchant)).status(), 200);
  } else {
    await test("existing logins work; SMTP is required before enabling verification", async () => {
      assert.equal((await login(platformContext, platform)).status(), 200);
      assert.equal((await login(merchantContext, merchant)).status(), 200);
      await platformPage.goto(`${APP}${ADMIN}/settings`);
      assert.equal(
        await platformPage.locator("#require-email-verification").isDisabled(),
        true,
      );
      await page.goto(`${APP}/forgot-password`);
      await page
        .getByText("平台尚未配置邮件服务。", { exact: false })
        .waitFor();
      await axe(page);
      await db.setting.upsert({
        where: { key: "smtp" },
        create: {
          key: "smtp",
          value: {
            host: "127.0.0.1",
            port: smtp.address().port,
            secure: false,
            from: "BeeSupport <noreply@test.local>",
          },
        },
        update: {},
      });
      await platformPage.reload();
      await platformPage.locator("#require-email-verification").click();
      await platformPage
        .getByRole("button", { name: "保存账号策略", exact: true })
        .click();
      await until(
        async () =>
          (
            await db.setting.findUnique({
              where: { key: "platform.account-policy" },
            })
          )?.value.requireEmailVerification === true,
        "policy saved",
      );
    });

    let applicant, verifyLink, resetLink;
    await test("registration sends real SMTP to local sink; verification requires explicit confirmation", async () => {
      await page.goto(`${APP}/register`);
      const email = `applicant-${stamp}@test.local`;
      for (const [field, value] of Object.entries({
        name: "邮箱验证商家",
        slug: `applicant-${stamp}`,
        ownerName: "验证管理员",
        ownerEmail: email,
        ownerPassword: password,
      }))
        await page.locator(`#register-${field}`).fill(value);
      await page.getByRole("button", { name: "提交入驻申请" }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "申请已提交" })
        .waitFor();
      applicant = await db.user.findUniqueOrThrow({ where: { email } });
      assert.equal(applicant.emailVerificationRequired, true);
      await db.tenant.update({
        where: { id: applicant.tenantId },
        data: { status: "ACTIVE" },
      });
      assert.equal((await login(publicContext, applicant)).status(), 403);
      verifyLink = await mailLink(email, "/verify-email");
      await page.goto(verifyLink);
      await page
        .getByRole("button", { name: "确认验证邮箱", exact: true })
        .waitFor();
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: applicant.id } }))
          .emailVerifiedAt,
        null,
      );
      await axe(page);
      await page
        .getByRole("button", { name: "确认验证邮箱", exact: true })
        .click();
      await page
        .getByRole("status")
        .filter({ hasText: "邮箱已验证" })
        .waitFor();
      assert.equal((await login(publicContext, applicant)).status(), 200);
      await page.goto(verifyLink);
      await page
        .getByRole("alert")
        .filter({ hasText: "已使用或已过期" })
        .waitFor();
      await publicContext.clearCookies();
    });

    await test("password recovery does not enumerate accounts and revokes existing sessions", async () => {
      const auth = await browser.newContext();
      assert.equal((await login(auth, applicant)).status(), 200);
      const existing = await page.request.post(`${APP}/api/auth/account`, {
        data: { operation: "request-reset", email: applicant.email },
      });
      const absent = await page.request.post(`${APP}/api/auth/account`, {
        data: {
          operation: "request-reset",
          email: `absent-${stamp}@test.local`,
        },
      });
      assert.equal(existing.status(), absent.status());
      assert.deepEqual(await existing.json(), await absent.json());
      resetLink = await mailLink(applicant.email, "/reset-password");
      await page.goto(resetLink);
      await page.locator("#account-password").fill(`${password}-new`);
      await page.locator("#account-confirmation").fill(`${password}-new`);
      await page.getByRole("button", { name: "重置密码", exact: true }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "密码已重置" })
        .waitFor();
      assert.equal(
        (await auth.request.get(`${APP}/api/auth/me`)).status(),
        401,
      );
      assert.equal(
        (await login(auth, applicant, `${password}-new`)).status(),
        200,
      );
      await page.goto(resetLink);
      await page
        .getByRole("alert")
        .filter({ hasText: "已使用或已过期" })
        .waitFor();
      await auth.close();
      const rejected = await page.request.post(`${APP}/api/auth/account`, {
        headers: { origin: "http://untrusted.invalid" },
        data: { operation: "request-reset", email: applicant.email },
      });
      assert.equal(rejected.status(), 403);
    });

    let inviteLink;
    await test("team invitations can be resent, revoked and accepted with scoped roles/sites", async () => {
      await merchantPage.goto(`${APP}${ADMIN}/agents`);
      await merchantPage
        .getByRole("button", { name: "邮件邀请成员", exact: true })
        .click();
      const email = `invited-${stamp}@test.local`;
      await merchantPage.locator("#invite-email").fill(email);
      await merchantPage.getByLabel("邀请验收站点", { exact: true }).check();
      await merchantPage
        .getByRole("button", { name: "发送邀请邮件", exact: true })
        .click();
      const row = merchantPage.getByRole("listitem").filter({ hasText: email });
      await row.waitFor();
      const oldLink = await mailLink(email, "/accept-invite");
      const inboxStart = inbox.length;
      await row.getByRole("button", { name: "重新发送", exact: true }).click();
      inviteLink = await mailLink(email, "/accept-invite", inboxStart);
      assert.notEqual(rawToken(oldLink), rawToken(inviteLink));
      await merchantPage.reload();
      await page.goto(oldLink);
      await page
        .getByRole("alert")
        .filter({ hasText: "已使用或已过期" })
        .waitFor();
      await row.getByRole("button", { name: "撤销邀请", exact: true }).click();
      await until(
        async () =>
          (await db.accountToken.count({
            where: { email, purpose: "INVITE", revokedAt: null },
          })) === 0,
        "invite revoked",
      );
      await page.goto(inviteLink);
      await page
        .getByRole("alert")
        .filter({ hasText: "已使用或已过期" })
        .waitFor();
      const activeEmail = `accepted-${stamp}@test.local`,
        start = inbox.length;
      await merchantPage
        .getByRole("button", { name: "邮件邀请成员", exact: true })
        .click();
      await merchantPage.locator("#invite-email").fill(activeEmail);
      await merchantPage.getByLabel("邀请验收站点", { exact: true }).check();
      await merchantPage
        .getByRole("button", { name: "发送邀请邮件", exact: true })
        .click();
      inviteLink = await mailLink(activeEmail, "/accept-invite", start);
      await page.goto(inviteLink);
      await page.locator("#account-name").fill("受邀客服");
      await page.locator("#account-password").fill(password);
      await page.locator("#account-confirmation").fill(password);
      await page
        .getByRole("button", { name: "接受邀请并创建账号", exact: true })
        .click();
      await page
        .getByRole("status")
        .filter({ hasText: "已加入团队" })
        .waitFor();
      const joined = await db.user.findUniqueOrThrow({
        where: { email: activeEmail },
        include: { sites: true },
      });
      assert.equal(joined.role, "AGENT");
      assert.equal(joined.tenantId, team.id);
      assert.ok(joined.emailVerifiedAt);
      assert.deepEqual(
        joined.sites.map((s) => s.siteId),
        [team.sites[0].id],
      );
      const joinedContext = await browser.newContext();
      assert.equal((await login(joinedContext, joined)).status(), 200);
      await joinedContext.close();
      // Next may flush a streamed layout before notFound(), returning HTTP 200.
      await merchantPage.goto(`${APP}${ADMIN}/settings`);
      await merchantPage
        .getByRole("heading", { name: "404", exact: true })
        .waitFor();
      assert.equal(
        await merchantPage.locator("#require-email-verification").count(),
        0,
      );
      await merchantPage.goto(`${APP}${ADMIN}/agents`);
      await axe(merchantPage);
    });

    await test("email verification defaults remain compatible; mobile auth and invite pages are accessible", async () => {
      await platformPage.goto(`${APP}${ADMIN}/settings`);
      await platformPage.locator("#require-email-verification").click();
      await platformPage
        .getByRole("button", { name: "保存账号策略", exact: true })
        .click();
      await until(
        async () =>
          (
            await db.setting.findUnique({
              where: { key: "platform.account-policy" },
            })
          )?.value.requireEmailVerification === false,
        "policy disabled",
      );
      await page.goto(`${APP}/register`);
      const email = `trusted-${stamp}@test.local`;
      for (const [field, value] of Object.entries({
        name: "默认验证关闭商家",
        slug: `trusted-${stamp}`,
        ownerName: "已有流程",
        ownerEmail: email,
        ownerPassword: password,
      }))
        await page.locator(`#register-${field}`).fill(value);
      await page.getByRole("button", { name: "提交入驻申请" }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "申请已提交" })
        .waitFor();
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { email } }))
          .emailVerificationRequired,
        false,
      );
      await page.setViewportSize({ width: 375, height: 812 });
      for (const path of [
        "/forgot-password",
        "/verify-email",
        "/reset-password",
        "/accept-invite",
      ]) {
        await page.goto(`${APP}${path}`);
        await page.getByRole("heading", { level: 1 }).waitFor();
        await axe(page);
      }
      await merchantPage.setViewportSize({ width: 375, height: 812 });
      await merchantPage.goto(`${APP}${ADMIN}/agents`);
      await axe(merchantPage);
      await merchantPage
        .getByRole("button", { name: "邮件邀请成员", exact: true })
        .click();
      await merchantPage.getByRole("dialog").waitFor();
      await axe(merchantPage);
      await merchantPage.screenshot({
        path: `${artifacts}/mobile-invitation.png`,
        fullPage: true,
      });
      await page.goto(`${APP}/forgot-password`);
      await page.screenshot({
        path: `${artifacts}/mobile-recovery.png`,
        fullPage: true,
      });
      assert.deepEqual(errors, []);
    });
  }
  if (process.env.E2E_DELIVERIES === "true") {
    const { runDeliveryChecks } = await import("./delivery-browser-checks.mjs");
    await runDeliveryChecks({
      db,
      browser,
      APP,
      ADMIN,
      page,
      platformPage,
      merchantPage,
      platform,
      merchant,
      team,
      test,
      until,
      axe,
      inbox,
      smtp,
      artifacts,
      stamp,
    });
  }
  if (process.env.E2E_REPORTING === "true") {
    const { runReportingChecks } =
      await import("./reporting-browser-checks.mjs");
    await runReportingChecks({
      db,
      browser,
      APP,
      ADMIN,
      page,
      platformPage,
      merchantPage,
      platform,
      merchant,
      team,
      test,
      until,
      axe,
      artifacts,
      stamp,
    });
  }
  if (process.env.E2E_CANNED === "true") {
    const { runCannedChecks } = await import("./canned-browser-checks.mjs");
    await runCannedChecks({
      db,
      browser,
      APP,
      ADMIN,
      page,
      platformPage,
      merchantPage,
      platform,
      merchant,
      team,
      test,
      until,
      axe,
      artifacts,
      stamp,
    });
  }
  if (process.env.E2E_FOLLOWUPS === "true") {
    const { runFollowUpChecks } =
      await import("./follow-ups-browser-checks.mjs");
    await runFollowUpChecks({
      db,
      browser,
      APP,
      ADMIN,
      page,
      platformPage,
      merchantPage,
      platform,
      merchant,
      team,
      test,
      until,
      axe,
      artifacts,
      stamp,
    });
  }
  if (process.env.E2E_AUTO_FOLLOWUPS === "true") {
    const { runAutoFollowUpChecks } =
      await import("./auto-follow-ups-browser-checks.mjs");
    await runAutoFollowUpChecks({
      db,
      browser,
      APP,
      ADMIN,
      page,
      platformPage,
      merchantPage,
      platform,
      merchant,
      team,
      test,
      until,
      axe,
      artifacts,
      stamp,
    });
  }
  if (process.env.E2E_UNANSWERED === "true") {
    const { runUnansweredChecks } =
      await import("./unanswered-browser-checks.mjs");
    await runUnansweredChecks({
      db,
      browser,
      APP,
      ADMIN,
      page,
      platformPage,
      merchantPage,
      platform,
      merchant,
      team,
      test,
      until,
      axe,
      artifacts,
      stamp,
    });
  }
  if (process.env.E2E_EFFICIENCY === "true") {
    const { runEfficiencyChecks } =
      await import("./efficiency-browser-checks.mjs");
    await runEfficiencyChecks({
      db,
      browser,
      APP,
      ADMIN,
      page,
      platformPage,
      merchantPage,
      platform,
      merchant,
      team,
      test,
      until,
      axe,
      artifacts,
      stamp,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    `${process.env.E2E_EFFICIENCY === "true" ? "Efficiency dashboard" : process.env.E2E_UNANSWERED === "true" ? "Unanswered reminders" : process.env.E2E_AUTO_FOLLOWUPS === "true" ? "Automatic follow-ups" : process.env.E2E_FOLLOWUPS === "true" ? "Follow-ups" : process.env.E2E_CANNED === "true" ? "Canned replies" : process.env.E2E_REPORTING === "true" ? "Reporting" : process.env.E2E_DELIVERIES === "true" ? "Delivery" : "Account-access"} browser validation: ${results.length} groups passed; ${inbox.length} messages captured locally`,
  );
} finally {
  await writeFile(
    `${artifacts}/results.json`,
    JSON.stringify({ results, errors }, null, 2),
  );
  await browser?.close();
  if (child && child.exitCode === null) {
    const stopped = once(child, "exit");
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 12000);
    await stopped;
    clearTimeout(timer);
  }
  for (const socket of sockets) socket.destroy();
  if (smtp.listening) await new Promise((resolve) => smtp.close(resolve));
  await db.$disconnect();
  if (created)
    await adminDb.$executeRawUnsafe(
      `DROP DATABASE "${databaseName}" WITH (FORCE)`,
    );
  await adminDb.$disconnect();
}
