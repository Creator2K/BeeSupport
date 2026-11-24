import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";
import { useTestDatabase } from "./test-environment.mjs";
import { createTestResources } from "./realtime-test-helpers.mjs";

useTestDatabase();
const app = new URL(process.env.TEST_APP_URL).origin;
const resources = createTestResources();
const db = new PrismaClient();
resources.add(() => db.$disconnect());
const stamp = randomUUID();
try {
  const { id: tenantId } = await db.tenant.create({ data: { name: "Widget test", slug: stamp } });
  resources.add(() => db.tenant.delete({ where: { id: tenantId } }));
  const site = await db.site.create({ data: { tenantId, name: "Widget test", slug: stamp } });
  resources.add(() => db.site.delete({ where: { id: site.id } }));
  const email = `agent-${stamp}@example.test`;
  const password = randomUUID();
  const agent = await db.user.create({ data: {
    tenantId, email, name: "Widget agent", passwordHash: await bcrypt.hash(password, 4),
    sites: { create: { siteId: site.id } },
  } });
  resources.add(() => db.user.delete({ where: { id: agent.id } }));
  resources.add(() => db.auditLog.deleteMany({ where: { tenantId } }));

  const browser = await chromium.launch();
  resources.add(() => browser.close());
  const visitor = await browser.newContext({ locale: "zh-CN" });
  const staff = await browser.newContext({ locale: "zh-CN" });
  const host = await visitor.newPage();
  await host.route(`${app}/embed-test`, (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><script defer src="/widget.js?key=${site.publicKey}"></script>`,
  }));
  await host.goto(`${app}/embed-test`);
  await host.locator(".beesupport-launcher").click();
  const frame = host.frameLocator('iframe[title="在线客服"]');
  const status = (text) => frame.getByText(text, { exact: true }).waitFor({ timeout: 20_000 });
  await frame.locator("#visitor-email").waitFor();
  await status("客服不在线");

  async function post(path, data) {
    const response = await staff.request.post(app + path, { data });
    assert.equal(response.ok(), true, `${path}: ${response.status()}`);
    return response.json();
  }
  await post("/api/auth/login", { email, password });
  await post("/api/agent/status", { status: "ONLINE" });
  await status("客服在线");
  await post("/api/agent/status", { status: "OFFLINE" });
  await status("客服不在线");
  console.log("Anonymous open widget followed online and offline transitions");

  await frame.locator("#visitor-email").fill("visitor@example.test");
  await frame.locator('form button[type="submit"]').click();
  const input = frame.locator("textarea");
  await input.fill("Start this test conversation");
  const sent = host.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/widget/conversation" && response.request().method() === "POST");
  await input.press("Enter");
  assert.equal((await sent).ok(), true);
  await frame.getByText("Start this test conversation", { exact: true }).waitFor();
  const saved = await db.message.findFirstOrThrow({
    where: { conversation: { siteId: site.id }, sender: "VISITOR" },
  });
  const path = `/api/agent/conversations/${saved.conversationId}/messages`;
  const page = await staff.newPage();
  await page.goto(`${app}/agent?c=${saved.conversationId}`);
  await page.getByText(saved.body, { exact: true }).last().waitFor();
  await status("客服在线");
  await post("/api/agent/status", { status: "AWAY" });
  await status("客服不在线");
  await post("/api/agent/status", { status: "ONLINE" });
  await status("客服在线");
  const upload = await staff.request.post(app + "/api/agent/upload", { multipart: {
    siteId: site.id, conversationId: saved.conversationId,
    file: { name: "remove-me.txt", mimeType: "text/plain", buffer: Buffer.from("test") },
  } });
  assert.equal(upload.ok(), true);
  const { attachment } = await upload.json();
  const text = "Reply with removable attachment";
  const { messageId } = await post(path, { body: text, attachmentIds: [attachment.id] });
  await frame.getByText(text, { exact: true }).waitFor();
  const reply = page.getByText(text, { exact: true }).last();
  await reply.waitFor();
  const button = page.getByRole("button", { name: "删除", exact: true });
  page.once("dialog", (dialog) => dialog.dismiss());
  await button.click();
  assert.equal(await reply.isVisible(), true);
  page.once("dialog", (dialog) => dialog.accept());
  await button.click();
  await frame.getByText("消息已删除", { exact: true }).waitFor({ timeout: 8000 });
  await page.getByText("消息已删除", { exact: true }).waitFor();
  assert.equal(await frame.getByText(text, { exact: true }).count(), 0);
  assert.equal((await staff.request.get(app + attachment.url)).status(), 404);
  assert.equal((await staff.request.delete(app + path, { data: { messageId } })).status(), 200);
  assert.equal((await staff.request.delete(app + path, { data: { messageId: saved.id } })).status(), 403);
  const deleted = await db.message.findUniqueOrThrow({ where: { id: messageId } });
  assert.ok(deleted.deletedAt);
  assert.equal(deleted.body, "");
  assert.equal(await db.auditLog.count({ where: { targetId: messageId, action: "message.delete" } }), 1);
  const conversation = await db.conversation.findUniqueOrThrow({ where: { id: saved.conversationId } });
  assert.equal(conversation.lastMessagePreview, null);
  assert.equal(conversation.unreadForVisitor, 0);
  const note = await post(`/api/agent/conversations/${saved.conversationId}/actions`, {
    action: "note", body: "Internal note to remove",
  });
  assert.equal((await staff.request.delete(app + path, { data: { messageId: note.messageId } })).status(), 200);
  await host.reload();
  await host.locator(".beesupport-launcher").click();
  await frame.getByText("消息已删除", { exact: true }).waitFor();
  assert.equal(await frame.getByText("消息已删除", { exact: true }).count(), 1);
  await page.close();
  await status("客服不在线");
  console.log("Live and reloaded clients, cancellation, persisted deletion, attachments and permissions passed");
} finally {
  await resources.close();
}
