import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { useTestDatabase } from "./test-environment.mjs";

useTestDatabase();
if (!process.env.TEST_APP_URL)
  throw new Error("需要 TEST_APP_URL 指向获准测试的应用");
const APP = process.env.TEST_APP_URL.replace(/\/$/, "");
const ADMIN = process.env.ADMIN_PATH || "/admin";
const artifacts = "/tmp/beesupport-analytics-images-results";
const stamp = randomUUID().replaceAll("-", "");
const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();
const siteIds = [];
const results = [];
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1xkAAAAASUVORK5CYII=",
  "base64",
);
let browser;
let page;
async function until(check, reason = "condition", timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timeout: ${reason}`);
}
async function test(name, operation) {
  try {
    await operation();
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
  const guest = await browser.newContext({ locale: "zh-CN" });
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
  const preview = await admin.newPage();
  preview.setDefaultTimeout(10000);
  const errors = [];
  for (const p of [page, preview])
    p.on("pageerror", (error) =>
      errors.push({ message: error.message, url: p.url() }),
    );
  const site = await db.site.create({
    data: {
      name: `图片验收 ${stamp.slice(0, 8)}`,
      slug: `img-${stamp}`,
      publicKey: `img-${stamp}`,
      autoAssign: false,
      requireEmail: true,
    },
  });
  siteIds.push(site.id);
  const legacy = await db.site.create({
    data: {
      name: `旧图验收 ${stamp.slice(0, 8)}`,
      slug: `old-${stamp}`,
      publicKey: `old-${stamp}`,
      autoAssign: false,
      requireEmail: false,
    },
  });
  siteIds.push(legacy.id);
  await writeFile(
    `${artifacts}/pending-fixtures.json`,
    JSON.stringify(siteIds),
  );
  const frame = () => preview.frameLocator('iframe[title="在线客服"]');
  let token, visitorId, conversationId, firstImage;
  const headers = () => ({ authorization: `Bearer ${token}` });
  const upload = (auth, name = "test.png") =>
    guest.request.post(`${APP}/api/widget/upload`, {
      headers: { authorization: `Bearer ${auth}` },
      multipart: { file: { name, mimeType: "image/png", buffer: png } },
    });
  async function setReview(target, enabled) {
    await page.goto(`${APP}${ADMIN}/sites`);
    await page
      .getByRole("row")
      .filter({ hasText: target.name })
      .locator('button[aria-haspopup="menu"]')
      .click();
    await page.getByRole("menuitem", { name: "编辑", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const toggle = dialog.getByRole("switch", {
      name: "图片逐张放行",
      exact: true,
    });
    if ((await toggle.isChecked()) !== enabled) await toggle.click();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await until(
      async () =>
        (await db.site.findUnique({ where: { id: target.id } }))
          .imageReviewEnabled === enabled,
      "site switch persisted",
    );
  }
  await test("整体画像按完整站点数据汇总；未聊天的匿名访问也计入，页面适配 PC/手机", async () => {
    await preview.goto(`${APP}/preview?key=${site.publicKey}`);
    await until(() => preview.evaluate(() => Boolean(window.BeeSupport)));
    await preview.evaluate(() => window.BeeSupport.open());
    await frame()
      .getByRole("button", { name: "开始对话", exact: true })
      .waitFor();
    await until(
      async () => (await db.visitor.count({ where: { siteId: site.id } })) > 0,
      "anonymous traffic recorded before chat",
    );
    assert.equal(
      await db.conversation.count({ where: { siteId: site.id } }),
      0,
    );
    const localKey = await frame()
      .locator("body")
      .evaluate(
        (_, key) => localStorage.getItem(`beesupport:localKey:${key}`),
        site.publicKey,
      );
    visitorId = (
      await db.visitor.findUnique({
        where: { siteId_localKey: { siteId: site.id, localKey } },
      })
    ).id;
    const anonymous = await guest.request.post(`${APP}/api/widget/visit`, {
      data: {
        key: site.publicKey,
        localKey,
        pageUrl: "https://example.test/features",
        env: {
          device: "手机",
          browser: "Chrome",
          os: "Android",
          locale: "zh-CN",
        },
      },
    });
    assert.deepEqual(await anonymous.json(), { ok: true });
    assert.equal(
      (
        await guest.request.post(`${APP}/api/widget/session`, {
          data: { key: site.publicKey, localKey },
        })
      ).status(),
      422,
    );
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${APP}${ADMIN}/visitors?siteId=${site.id}&days=7`);
      await page
        .getByRole("heading", { name: "新增访客趋势", exact: true })
        .waitFor();
      assert.equal(
        await page.getByRole("button", { name: /新增 \d+ 位访客/ }).count(),
        7,
      );
      assert.equal(
        await page.getByRole("link", { name: "查看画像", exact: true }).count(),
        0,
      );
      const metric = page.getByRole("article").filter({ hasText: "累计访客" });
      assert.equal(
        (await metric.locator("p").first().innerText()).replaceAll(",", ""),
        String(await db.visitor.count({ where: { siteId: site.id } })),
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      const axe = await new AxeBuilder({ page })
        .withRules(["button-name", "label", "select-name", "aria-meter-name"])
        .analyze();
      assert.deepEqual(
        axe.violations.map((v) => v.id),
        [],
      );
      await page.screenshot({
        path: `${artifacts}/analytics-${width}.png`,
        fullPage: true,
      });
    }
    await page.getByRole("link", { name: "访客明细", exact: true }).click();
    await page
      .getByRole("heading", { name: "访客明细", exact: true })
      .waitFor();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await frame().locator("#visitor-email").fill("images@example.test");
    await frame()
      .getByRole("button", { name: "开始对话", exact: true })
      .click();
    await frame().locator("textarea").last().waitFor();
    token = await frame()
      .locator("body")
      .evaluate(
        (_, key) =>
          JSON.parse(localStorage.getItem(`beesupport:visitor:${key}`)).token,
        site.publicKey,
      );
    assert.equal(
      await db.visitor.count({ where: { siteId: site.id } }),
      1,
      "anonymous visitor becomes the same chat identity",
    );
  });
  await test("站点开关保存后，并发上传六张只接收一张，未发送图片可取消释放名额", async () => {
    await setReview(site, true);
    const response = await guest.request
      .post(`${APP}/api/widget/session`, {
        data: {
          key: site.publicKey,
          localKey: `parallel-${stamp}`,
          email: "parallel@example.test",
        },
      })
      .then((r) => r.json());
    const attempts = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        upload(response.token, `parallel-${index}.png`),
      ),
    );
    assert.equal(attempts.filter((r) => r.status() === 200).length, 1);
    assert.equal(attempts.filter((r) => r.status() === 409).length, 5);
    const pending = await attempts.find((r) => r.status() === 200).json();
    assert.equal(
      (
        await guest.request.post(
          `${APP}/api/agent/attachments/${pending.attachment.id}/approve`,
        )
      ).status(),
      401,
    );
    const canceled = await guest.request.delete(`${APP}/api/widget/images`, {
      headers: { authorization: `Bearer ${response.token}` },
      data: { attachmentId: pending.attachment.id },
    });
    assert.equal(canceled.status(), 200);
    assert.equal((await canceled.json()).pending, null);
    assert.equal(
      await db.attachment.findUnique({ where: { id: pending.attachment.id } }),
      null,
    );
  });
  await test("访客等待期间可发文字；客服点允许后，原窗口实时获得下一张名额", async () => {
    await frame()
      .getByText("本站点图片需逐张放行，发图后请等待客服允许。", {
        exact: true,
      })
      .waitFor({ timeout: 20000 });
    await frame()
      .locator('input[type="file"]')
      .setInputFiles({ name: "first.png", mimeType: "image/png", buffer: png });
    await frame()
      .getByText("图片已发送，等待客服允许后可再发下一张。", { exact: true })
      .waitFor();
    firstImage = await db.attachment.findFirst({
      where: { siteId: site.id, uploaderId: visitorId, filename: "first.png" },
    });
    conversationId = (
      await db.message.findUnique({ where: { id: firstImage.messageId } })
    ).conversationId;
    assert.equal((await upload(token, "blocked.png")).status(), 409);
    await preview.reload();
    await until(() => preview.evaluate(() => Boolean(window.BeeSupport)));
    await preview.evaluate(() => window.BeeSupport.open());
    await frame()
      .getByText("图片已发送，等待客服允许后可再发下一张。", { exact: true })
      .waitFor();
    await frame().locator("textarea").last().fill("等待图片放行时仍能发文字");
    await frame().getByRole("button", { name: "发送", exact: true }).click();
    await until(
      async () =>
        (await db.message.count({
          where: { conversationId, body: "等待图片放行时仍能发文字" },
        })) === 1,
    );
    await page.goto(`${APP}/agent?c=${conversationId}`);
    await page
      .getByRole("button", { name: "允许再发一张", exact: true })
      .click();
    await frame()
      .getByText("本站点图片需逐张放行，发图后请等待客服允许。", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      (
        await guest.request
          .get(`${APP}/api/widget/images`, { headers: headers() })
          .then((r) => r.json())
      ).pending,
      null,
    );
  });
  await test("重新放行旧图片不会释放后来一张的限制；已发送不能自行取消", async () => {
    const response = await upload(token, "second.png");
    assert.equal(response.status(), 200);
    const second = (await response.json()).attachment;
    assert.equal(
      (
        await guest.request.post(`${APP}/api/widget/conversation`, {
          headers: headers(),
          data: {
            conversationId,
            body: "",
            attachmentIds: [second.id],
            clientId: `image:${second.id}`,
          },
        })
      ).status(),
      200,
    );
    assert.equal(
      (
        await guest.request.delete(`${APP}/api/widget/images`, {
          headers: headers(),
          data: { attachmentId: second.id },
        })
      ).status(),
      409,
    );
    const duplicate = await admin.request.post(
      `${APP}/api/agent/attachments/${firstImage.id}/approve`,
    );
    assert.equal(duplicate.status(), 200);
    assert.equal((await duplicate.json()).changed, false);
    assert.equal(
      (
        await guest.request
          .get(`${APP}/api/widget/images`, { headers: headers() })
          .then((r) => r.json())
      ).pending.id,
      second.id,
    );
    assert.equal((await upload(token, "still-blocked.png")).status(), 409);
    assert.equal(
      (
        await admin.request.post(
          `${APP}/api/agent/attachments/${second.id}/approve`,
        )
      ).status(),
      200,
    );
  });
  await test("图片发送中断可重试或取消；服务端已收到但响应丢失时不会重复发图", async () => {
    const pattern = "**/api/widget/conversation";
    await preview.route(pattern, (route) =>
      route.request().method() === "POST" ? route.abort() : route.continue(),
    );
    await frame()
      .locator('input[type="file"]')
      .setInputFiles({ name: "retry.png", mimeType: "image/png", buffer: png });
    await frame()
      .getByRole("button", { name: "重试发送图片", exact: true })
      .waitFor();
    await preview.unroute(pattern);
    await frame()
      .getByRole("button", { name: "重试发送图片", exact: true })
      .click();
    await frame()
      .getByText("图片已发送，等待客服允许后可再发下一张。", { exact: true })
      .waitFor();
    const retry = await db.attachment.findFirst({
      where: { siteId: site.id, uploaderId: visitorId, filename: "retry.png" },
    });
    assert.equal(
      await db.message.count({
        where: { conversationId, clientId: `image:${retry.id}` },
      }),
      1,
    );
    await admin.request.post(
      `${APP}/api/agent/attachments/${retry.id}/approve`,
    );
    await until(
      async () =>
        !(
          await guest.request
            .get(`${APP}/api/widget/images`, { headers: headers() })
            .then((r) => r.json())
        ).pending,
    );
    await preview.route(pattern, (route) =>
      route.request().method() === "POST" ? route.abort() : route.continue(),
    );
    await frame().locator('input[type="file"]').setInputFiles({
      name: "cancel.png",
      mimeType: "image/png",
      buffer: png,
    });
    await frame()
      .getByRole("button", { name: "取消未发送图片", exact: true })
      .click();
    await preview.unroute(pattern);
    await until(
      async () =>
        !(await db.attachment.findFirst({
          where: {
            siteId: site.id,
            uploaderId: visitorId,
            filename: "cancel.png",
          },
        })),
    );
    let lostResponseHandled = false;
    let lostResponseError;
    await preview.route(pattern, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      try {
        await route.fetch();
        await route.abort();
      } catch (error) {
        lostResponseError = error;
      } finally {
        lostResponseHandled = true;
      }
    });
    await frame()
      .locator('input[type="file"]')
      .setInputFiles({ name: "lost.png", mimeType: "image/png", buffer: png });
    await until(async () =>
      Boolean(
        (
          await db.attachment.findFirst({
            where: {
              siteId: site.id,
              uploaderId: visitorId,
              filename: "lost.png",
            },
          })
        )?.messageId,
      ),
    );
    await until(
      () => lostResponseHandled,
      "lost-response interception completed",
    );
    if (lostResponseError) throw lostResponseError;
    await preview.unroute(pattern);
    const lost = await db.attachment.findFirst({
      where: { siteId: site.id, uploaderId: visitorId, filename: "lost.png" },
    });
    assert.equal(
      (
        await guest.request.post(`${APP}/api/widget/conversation`, {
          headers: headers(),
          data: {
            conversationId,
            body: "",
            attachmentIds: [lost.id],
            clientId: `image:${lost.id}`,
          },
        })
      ).status(),
      200,
    );
    assert.equal(
      await db.message.count({
        where: { conversationId, clientId: `image:${lost.id}` },
      }),
      1,
    );
    await admin.request.post(`${APP}/api/agent/attachments/${lost.id}/approve`);
  });
  await test("开关开启前上传的旧附件也受限制，不能合并两张或换会话绕过", async () => {
    const identity = await guest.request
      .post(`${APP}/api/widget/session`, {
        data: { key: legacy.publicKey, localKey: `legacy-${stamp}` },
      })
      .then((r) => r.json());
    const one = await upload(identity.token, "old-one.png").then((r) =>
      r.json(),
    );
    const two = await upload(identity.token, "old-two.png").then((r) =>
      r.json(),
    );
    await setReview(legacy, true);
    const auth = { authorization: `Bearer ${identity.token}` };
    assert.equal(
      (
        await guest.request.post(`${APP}/api/widget/conversation`, {
          headers: auth,
          data: {
            body: "",
            attachmentIds: [one.attachment.id, two.attachment.id],
          },
        })
      ).status(),
      409,
    );
    assert.equal(
      (
        await guest.request.post(`${APP}/api/widget/conversation`, {
          headers: auth,
          data: { body: "", attachmentIds: [one.attachment.id] },
        })
      ).status(),
      200,
    );
    assert.equal(
      (
        await guest.request.post(`${APP}/api/widget/conversation`, {
          headers: auth,
          data: { body: "", attachmentIds: [two.attachment.id] },
        })
      ).status(),
      409,
    );
  });
  await test("关闭站点开关立即解除等待，客服发图不受访客图片名额限制", async () => {
    const uploadResponse = await upload(token, "release.png");
    assert.equal(uploadResponse.status(), 200);
    const image = (await uploadResponse.json()).attachment;
    await guest.request.post(`${APP}/api/widget/conversation`, {
      headers: headers(),
      data: { conversationId, body: "", attachmentIds: [image.id] },
    });
    const staffUpload = await admin.request.post(`${APP}/api/agent/upload`, {
      multipart: {
        siteId: site.id,
        conversationId,
        file: { name: "staff.png", mimeType: "image/png", buffer: png },
      },
    });
    assert.equal(staffUpload.status(), 200);
    await setReview(site, false);
    await frame()
      .getByText("图片已发送，等待客服允许后可再发下一张。", { exact: true })
      .waitFor({ state: "hidden" });
    assert.deepEqual(
      await guest.request
        .get(`${APP}/api/widget/images`, { headers: headers() })
        .then((r) => r.json()),
      { enabled: false, pending: null },
    );
    assert.equal(
      (await db.attachment.findUnique({ where: { id: image.id } }))
        .imageReviewState,
      "RELEASED",
    );
    assert.equal((await upload(token, "open-one.png")).status(), 200);
    assert.equal((await upload(token, "open-two.png")).status(), 200);
    assert.deepEqual(errors, []);
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (siteIds.length) {
    await db.site.deleteMany({ where: { id: { in: siteIds } } });
    const uploadRoot = resolve(process.env.UPLOAD_DIR || "data/uploads");
    for (const id of siteIds)
      await rm(join(uploadRoot, id), { recursive: true, force: true });
    await rm(`${artifacts}/pending-fixtures.json`, { force: true });
  }
  await db.$disconnect();
  await mkdir(artifacts, { recursive: true });
  await writeFile(
    `${artifacts}/results.json`,
    JSON.stringify(results, null, 2),
  );
  const passed = results.filter((result) => result.ok).length;
  console.log(
    `\n整体画像与图片放行回归：${passed}/${results.length}；证据：${artifacts}`,
  );
  if (passed !== results.length || results.length !== 7) process.exitCode = 1;
}
