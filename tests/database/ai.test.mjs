import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { auth, loadAiModule, loadAiToolsModule, loadModule } from "../load-module.mjs";
import { useTestDatabase } from "../../scripts/test-environment.mjs";

useTestDatabase();
const { PrismaClient } = await import("@prisma/client");
const ai = loadAiModule();

async function fixture(run) {
  const prisma = new PrismaClient();
  const stamp = randomUUID();
  let tenant;
  try {
    tenant = await prisma.tenant.create({ data: { name: "AI concurrency test", slug: stamp } });
    const site = await prisma.site.create({ data: { name: "AI test", slug: stamp, tenantId: tenant.id,
      visitors: { create: { localKey: stamp, email: "visitor@test.local" } } }, include: { visitors: true } });
    const conversation = await prisma.conversation.create({ data: { siteId: site.id, visitorId: site.visitors[0].id,
      aiReplyToken: stamp, aiReplyExpiresAt: new Date(Date.now() + 60_000),
      messages: { create: { sender: "VISITOR", type: "TEXT", body: "help" } } }, include: { messages: true } });
    const config = { ...ai.defaultAiConfig(), enabled: true, apiKey: "test", model: "test", enableTools: true, autoReply: "always" };
    const context = () => ({ conversationId: conversation.id, siteId: site.id, visitorId: site.visitors[0].id,
      config, allowMutations: true, leaseToken: stamp, expectedMessageId: conversation.messages[0].id, trace: [], knowledge: new Map() });
    const dependencies = {
      "../../lib/db": { prisma },
      "../../lib/ai": { ...ai, getAiConfig: async () => config },
      "../../lib/auth": auth,
      "../../lib/visitor-env": {},
      "../transactions": loadModule("src/server/transactions.ts"),
      "./broadcast": { broadcastMessage: async () => {}, broadcastConversation: async () => {} },
    };
    const tools = (overrides = {}) => loadAiToolsModule({ ...dependencies, ...overrides });
    await run({ prisma, tenant, site, conversation, context, tools, dependencies });
  } finally {
    if (tenant) {
      await prisma.site.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
    await prisma.$disconnect();
  }
}

test("PostgreSQL serializes concurrent AI tag merges without losing additions", () => fixture(async ({ prisma, conversation, context, tools }) => {
  const actions = tools();
  await Promise.all(["refund", "urgent", "invoice", "delivery"].map((tag) =>
    actions.tagConversation(context(), { tags: [tag] }, "tag_conversation", Date.now())));
  const saved = await prisma.conversation.findUnique({ where: { id: conversation.id } });
  assert.deepEqual(saved.tags.sort(), ["delivery", "invoice", "refund", "urgent"]);
}));

test("AI escalation rolls back on note failure and survives post-commit broadcast failure", () => fixture(async ({ prisma, conversation, context, tools }) => {
  const failingDb = new Proxy(prisma, { get(target, name) {
    if (name === "$transaction") return (callback) => target.$transaction((tx) => callback(new Proxy(tx, { get(transaction, key) {
      if (key === "message") return { create: async () => { throw new Error("note insert failed"); } };
      return transaction[key];
    } })));
    return target[name];
  } });
  await assert.rejects(tools({ "../../lib/db": { prisma: failingDb } }).escalateToHuman(context(), { priority: 3 }, "escalate_to_human", Date.now()), /note insert failed/);
  const saved = await prisma.conversation.findUnique({ where: { id: conversation.id } });
  assert.equal(saved.priority, conversation.priority);
  assert.equal(await prisma.message.count({ where: { conversationId: conversation.id, type: "NOTE" } }), 0);
  let notified = false;
  const result = await tools({ "./broadcast": {
    broadcastMessage: async () => { throw new Error("broadcast offline"); },
    broadcastConversation: async () => { notified = true; },
  } }).escalateToHuman(context(), { priority: 2.6 }, "escalate_to_human", Date.now());
  assert.match(result, /已把会话/);
  assert.equal(notified, true);
  assert.equal((await prisma.conversation.findUnique({ where: { id: conversation.id } })).priority, 3);
  assert.equal(await prisma.message.count({ where: { conversationId: conversation.id, type: "NOTE" } }), 1);
}));

test("AI mutation checks run after acquiring the database lock and reject stale generations", { timeout: 15_000 }, () => fixture(async ({ prisma, conversation, context, tools }) => {
  let attempted;
  const lockAttempt = new Promise((resolve) => { attempted = resolve; });
  const actualLock = loadModule("src/server/transactions.ts").lockConversation;
  const actions = tools({ "../transactions": { lockConversation: async (tx, id) => { attempted(); await actualLock(tx, id); } } });
  let release, locked;
  const acquired = new Promise((resolve) => { locked = resolve; });
  const hold = new Promise((resolve) => { release = resolve; });
  const human = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversation.id} FOR UPDATE`;
    await tx.message.create({ data: { conversationId: conversation.id, sender: "AGENT", type: "TEXT", body: "Handled", createdAt: new Date(Date.now() + 1000) } });
    locked();
    await hold;
  });
  await acquired;
  const aiAction = actions.tagConversation(context(), { tags: ["stale"] }, "tag_conversation", Date.now());
  await lockAttempt;
  release();
  await human;
  await assert.rejects(aiAction, /状态已改变/);
  await assert.rejects(actions.escalateToHuman(context(), { priority: 3 }, "escalate_to_human", Date.now()), /状态已改变/);
  const saved = await prisma.conversation.findUnique({ where: { id: conversation.id } });
  assert.deepEqual(saved.tags, []);
  assert.equal(saved.priority, conversation.priority);
  assert.equal(await prisma.message.count({ where: { conversationId: conversation.id, type: "NOTE" } }), 0);
}));
