import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { useTestDatabase, restoreSetting } from "./test-environment.mjs";
import { closeTestServer } from "./realtime-test-helpers.mjs";

useTestDatabase();
if (!process.env.TEST_APP_URL) throw Error("Set TEST_APP_URL to an isolated test application");
const APP = process.env.TEST_APP_URL.replace(/\/$/, "");
const ADMIN = process.env.ADMIN_PATH || "/admin";
const artifacts = path.resolve(process.env.AI_QUEUE_E2E_ARTIFACTS || "test-results/ai-queue/browser");
const db = new PrismaClient();
const stamp = randomUUID();
const title = `AI queue verification ${stamp}`;
const results = [];
const held = [];
let mode = "hold", browser, page, entry;
const saved = await db.setting.findUnique({ where: { key: "ai" } });
const sendVector = (res, count) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ data: Array.from({ length: count }, (_, index) => ({ index, embedding: [1, 0] })) }));
};
const mock = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  if (mode === "hold") held.push({ res, count: body.input.length });
  else if (mode === "fail") { res.writeHead(503); res.end("temporary test failure"); }
  else sendVector(res, body.input.length);
});
async function until(predicate, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error(`Timed out: ${label}`);
}
const passed = (name) => { results.push({ name, ok: true }); console.log(`PASS ${name}`); };

try {
  await mkdir(artifacts, { recursive: true });
  await until(async () => { try { return (await fetch(`${APP}/api/health/ready`)).ok; } catch { return false; } }, "test application ready", 30_000);
  await until(async () => await db.aiJob.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }) === 0, "existing test tasks finish");
  mock.listen(0, "127.0.0.1");
  await once(mock, "listening");
  const config = { enabled: true, baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, apiKey: "local-test", model: "mock",
    models: ["mock"], autoReply: "off", enableTools: false, enableEmbeddings: true, embeddingModel: "mock-vector" };
  await db.setting.upsert({ where: { key: "ai" }, create: { key: "ai", value: config }, update: { value: config } });
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const login = await context.request.post(`${APP}/api/auth/login`, { data: {
    email: process.env.SEED_ADMIN_EMAIL || "admin@beesupport.local",
    password: process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!",
  } });
  assert.equal(login.status(), 200);
  page = await context.newPage();
  await page.goto(`${APP}${ADMIN}/ai`);
  // Capture settled theme colors rather than intermediate CSS transition frames.
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  await page.getByRole("tab", { name: /知识库/ }).click();
  await page.getByRole("button", { name: "新增条目", exact: true }).first().click();
  await page.locator("#kb-title").fill(title);
  await page.locator("#kb-content").fill("持久化任务恢复验证。退款将在审核后处理，请联系客服确认订单。 ".repeat(3));
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await until(async () => { entry = await db.aiKnowledge.findFirst({ where: { title } }); return Boolean(entry); }, "knowledge saved");
  await until(async () => (await db.aiJob.findUnique({ where: { knowledgeId: entry.id } }))?.status === "PROCESSING" && held.length > 0, "durable indexing task claimed");
  await page.getByText("正在更新", { exact: true }).waitFor();
  passed("knowledge save enqueues an index task and shows live progress");

  for (const [device, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 390, height: 844 }]]) {
    await page.setViewportSize(viewport);
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => { document.documentElement.classList.toggle("dark", value === "dark"); document.documentElement.style.colorScheme = value; }, theme);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: path.join(artifacts, `${device}-${theme}.png`), fullPage: true });
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      await writeFile(path.join(artifacts, `${device}-${theme}-axe.json`), JSON.stringify(axe.violations, null, 2));
      assert.deepEqual(axe.violations.map((item) => item.id), [], `${device} ${theme} accessibility`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
  }
  passed("desktop and mobile indexing states pass light/dark accessibility checks");
  mode = "ok";
  for (const response of held.splice(0)) sendVector(response.res, response.count);
  await until(async () => (await db.aiJob.findUnique({ where: { knowledgeId: entry.id } }))?.status === "COMPLETED", "index completion");
  await until(async () => !(await page.getByText("正在更新", { exact: true }).count()), "automatic completion refresh");
  assert.ok(await db.aiKnowledgeChunk.count({ where: { knowledgeId: entry.id } }));
  passed("index completion refreshes the page without a manual reload");

  mode = "fail";
  await page.getByRole("button", { name: "重建该条目索引", exact: true }).click();
  await page.getByText(/已安排更新 1 篇知识/).waitFor();
  await until(async () => {
    const job = await db.aiJob.findUnique({ where: { knowledgeId: entry.id } });
    if (job.status === "FAILED") return true;
    if (job.status === "PENDING" && job.attempts > 0)
      await db.aiJob.update({ where: { id: job.id }, data: { availableAt: new Date(0) } });
    return false;
  }, "bounded index retry failure");
  await page.getByText("更新失败，可选择该条目重新重建", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(artifacts, "index-failed.png"), fullPage: true });
  const failed = await db.aiJob.findUnique({ where: { knowledgeId: entry.id } });
  assert.equal(failed.attempts, 3);
  assert.match(failed.lastError, /503/);
  mode = "ok";
  await page.getByRole("button", { name: "重建该条目索引", exact: true }).click();
  await until(async () => {
    const job = await db.aiJob.findUnique({ where: { knowledgeId: entry.id } });
    return job.revision > failed.revision && job.status === "COMPLETED";
  }, "manual retry after provider recovery");
  passed("failed tasks show a recoverable state and can be rebuilt after provider recovery");
} catch (error) {
  results.push({ name: "failure", ok: false, error: error.message });
  await page?.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  for (const { res } of held) res.destroy();
  await closeTestServer(mock);
  await db.aiKnowledge.deleteMany({ where: { title } });
  await restoreSetting(db, "ai", saved);
  await db.$disconnect();
  await writeFile(path.join(artifacts, "results.json"), JSON.stringify(results, null, 2));
}
