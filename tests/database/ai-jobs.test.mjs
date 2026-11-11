import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { auth, tenants, loadAiModule, loadAiService, loadAiToolsModule, loadMessageService, loadModule } from "../load-module.mjs";
import { useTestDatabase, restoreSetting } from "../../scripts/test-environment.mjs";
import { closeTestServer } from "../../scripts/realtime-test-helpers.mjs";

useTestDatabase();
const { PrismaClient } = await import("@prisma/client");
const helpers = loadAiModule();
const locks = loadModule("src/server/transactions.ts");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(predicate, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await sleep(50);
  }
  assert.fail("Timed out waiting for the durable AI task");
}

async function fixture(run) {
  const db = new PrismaClient();
  const stamp = randomUUID();
  let tenant;
  try {
    tenant = await db.tenant.create({ data: { name: "AI queue test", slug: stamp } });
    await db.aiPolicy.create({ data: { tenantId: tenant.id, concurrencyLimit: 1 } });
    const site = await db.site.create({ data: { tenantId: tenant.id, name: "Queue test", slug: stamp,
      visitors: { create: { email: "visitor@test.local", localKey: stamp } } }, include: { visitors: true } });
    const conversation = await db.conversation.create({ data: { siteId: site.id, visitorId: site.visitors[0].id,
      messages: { create: { sender: "VISITOR", body: "Help me" } } }, include: { messages: true } });
    const config = { ...helpers.defaultAiConfig(), enabled: true, autoReply: "always", enableTools: false, enableEmbeddings: false, apiKey: "mock", model: "mock" };
    const lib = { ...helpers, getAiConfig: async () => config, retrieveKnowledge: async () => [],
      chatCompletion: async () => ({ content: "Answer", toolCalls: [], usage: null }),
    };
    const deps = { "../../lib/db": { prisma: db }, "../../lib/ai": lib, "../../lib/auth": { ...auth, countOnlineAgents: async () => 0 },
      "../../lib/visitor-env": {}, "../transactions": locks, "./tenants": tenants,
      "./broadcast": { broadcastMessage: async () => {}, broadcastConversation: async () => {} },
      "./entitlements": { getSiteFeatures: async () => ({ ai: true }) },
    };
    const queue = loadModule("src/server/services/ai-job-queue.ts", deps);
    deps["./ai-job-queue"] = queue;
    deps["./ai-tools"] = loadAiToolsModule(deps);
    const service = () => loadAiService(deps);
    const knowledge = loadModule("src/server/services/knowledge.ts", deps);
    const enqueue = (messageId = conversation.messages[0].id) => db.$transaction((tx) => queue.enqueueAiReply(tx, tenant.id, conversation.id, messageId));
    await run({ db, tenant, site, conversation, config, lib, deps, queue, service, knowledge, enqueue });
  } finally {
    if (tenant) {
      await db.site.deleteMany({ where: { tenantId: tenant.id } });
      await db.aiKnowledge.deleteMany({ where: { tenantId: tenant.id } });
      await db.tenant.delete({ where: { id: tenant.id } });
    }
    await db.$disconnect();
  }
}

test("visitor messages and AI tasks commit atomically, and client retries do not enqueue again", () => fixture(async ({ db, site, conversation, deps }) => {
  const messages = loadMessageService({ ...deps, "./notifications": { notifyVisitorMessage: async () => {} },
    "../../lib/realtime/emit": {}, "../../lib/realtime/public": {}, "../serialize": {}, });
  const input = { conversationId: conversation.id, siteId: site.id, sender: "VISITOR", body: "New question", clientId: randomUUID(), uploaderId: site.visitors[0].id };
  await assert.rejects(db.$transaction(async (tx) => {
    await messages.writeMessage(tx, input);
    throw new Error("rollback after enqueue");
  }), /rollback after enqueue/);
  assert.equal(await db.aiJob.count({ where: { conversationId: conversation.id } }), 0);
  assert.equal(await db.message.count({ where: { conversationId: conversation.id } }), 1);
  const first = await db.$transaction((tx) => messages.writeMessage(tx, input));
  const retry = await db.$transaction((tx) => messages.writeMessage(tx, input));
  assert.equal(first.id, retry.id);
  const task = await db.aiJob.findUnique({ where: { conversationId: conversation.id } });
  assert.equal(task.messageId, first.id);
  assert.equal(task.revision, 1);
}));

test("concurrent workers claim once; expired leases recover and reject the previous owner", () => fixture(async ({ db, conversation, enqueue, queue, service }) => {
  await enqueue();
  const claims = await Promise.all([queue.claimAiJob(), queue.claimAiJob(), queue.claimAiJob()]);
  assert.equal(claims.filter(Boolean).length, 1);
  const original = claims.find(Boolean);
  await db.aiJob.update({ where: { id: original.id }, data: { lockedUntil: new Date(0) } });
  const reclaimed = await queue.claimAiJob();
  assert.equal(reclaimed.attempts, 2);
  assert.notEqual(reclaimed.leaseToken, original.leaseToken);
  await queue.renewAiJob(original);
  assert.equal((await db.aiJob.findUnique({ where: { id: original.id } })).lockedUntil.getTime(), reclaimed.lockedUntil.getTime());
  await queue.finishAiJob(original, { status: "COMPLETED" });
  assert.equal((await db.aiJob.findUnique({ where: { id: original.id } })).leaseToken, reclaimed.leaseToken);
  assert.equal((await service().processAutoReply(original)).status, "SKIPPED");
  const result = await service().processAutoReply(reclaimed);
  await queue.finishAiJob(reclaimed, result);
  assert.equal(result.status, "COMPLETED");
  assert.equal(await db.message.count({ where: { conversationId: conversation.id, sender: "AI" } }), 1);
}));

test("a newer visitor message survives completion of an older revision", () => fixture(async ({ db, conversation, enqueue, queue, service }) => {
  await enqueue();
  const original = await queue.claimAiJob();
  const newer = await db.message.create({ data: { conversationId: conversation.id, sender: "VISITOR", body: "Newer question", createdAt: new Date(Date.now() + 1000) } });
  await enqueue(newer.id);
  await queue.finishAiJob(original, new Error("old provider request failed"));
  const pending = await db.aiJob.findUnique({ where: { id: original.id } });
  assert.equal(pending.status, "PENDING");
  assert.equal(pending.attempts, 0);
  assert.equal(pending.lastError, null);
  const next = await queue.claimAiJob();
  assert.equal(next.messageId, newer.id);
  assert.equal(next.revision, 2);
  assert.equal((await service().processAutoReply(next)).status, "COMPLETED");
}));

test("retry limits and abandoned final attempts terminate with inspectable failures", () => fixture(async ({ db, enqueue, queue }) => {
  await enqueue();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const job = await queue.claimAiJob();
    assert.equal(job.attempts, attempt);
    await queue.finishAiJob(job, new Error(`provider failure ${attempt}`));
    const saved = await db.aiJob.findUnique({ where: { id: job.id } });
    assert.equal(saved.status, attempt === 3 ? "FAILED" : "PENDING");
    assert.equal(saved.lastError, `provider failure ${attempt}`);
    if (attempt < 3) {
      assert.ok(saved.availableAt > new Date());
      assert.equal(await queue.claimAiJob(), null);
      await db.aiJob.update({ where: { id: job.id }, data: { availableAt: new Date(0) } });
    } else {
      assert.equal(await queue.claimAiJob(), null);
      await db.aiJob.update({ where: { id: job.id }, data: { status: "PROCESSING", leaseToken: "abandoned", lockedUntil: new Date(0) } });
      await queue.expireAiJobs();
      assert.equal((await db.aiJob.findUnique({ where: { id: job.id } })).status, "FAILED");
    }
  }
}));

test("reply and task completion commit atomically before the worker can acknowledge", () => fixture(async ({ db, conversation, enqueue, queue, service }) => {
  await enqueue();
  const job = await queue.claimAiJob();
  assert.equal((await service().processAutoReply(job)).status, "COMPLETED");
  // No finishAiJob call: killing the process here still leaves a completed, unclaimable task.
  assert.equal((await db.aiJob.findUnique({ where: { id: job.id } })).status, "COMPLETED");
  assert.equal(await queue.claimAiJob(), null);
  assert.equal(await db.message.count({ where: { conversationId: conversation.id, sender: "AI" } }), 1);
  assert.equal((await db.conversation.findUnique({ where: { id: conversation.id } })).unreadForVisitor, 1);
}));

test("knowledge jobs roll back with edits and older embedding results cannot overwrite newer content", () => fixture(async ({ db, tenant, queue, knowledge, lib, config }) => {
  const entry = await db.aiKnowledge.create({ data: { tenantId: tenant.id, title: "Refund", content: "old policy" } });
  await assert.rejects(db.$transaction(async (tx) => {
    await tx.aiKnowledge.update({ where: { id: entry.id }, data: { content: "rolled back" } });
    await queue.enqueueKnowledgeIndex(tx, tenant.id, entry.id);
    throw new Error("rollback index request");
  }), /rollback index request/);
  assert.equal(await db.aiJob.count({ where: { knowledgeId: entry.id } }), 0);
  assert.equal((await db.aiKnowledge.findUnique({ where: { id: entry.id } })).content, "old policy");
  config.enableEmbeddings = true;
  let completeEmbedding;
  lib.embedTexts = async () => new Promise((resolve) => { completeEmbedding = () => resolve([[1, 0]]); });
  await knowledge.requestKnowledgeIndex({ knowledgeId: entry.id });
  const oldJob = await queue.claimAiJob();
  const pending = knowledge.processKnowledgeIndex(oldJob);
  await eventually(() => completeEmbedding);
  await db.$transaction(async (tx) => {
    await tx.aiKnowledge.update({ where: { id: entry.id }, data: { content: "new policy" } });
    await queue.enqueueKnowledgeIndex(tx, tenant.id, entry.id, false);
  });
  completeEmbedding();
  const stale = await pending;
  assert.equal(stale.status, "SKIPPED");
  await queue.finishAiJob(oldJob, stale);
  const latest = await queue.claimAiJob();
  const result = await knowledge.processKnowledgeIndex(latest);
  await queue.finishAiJob(latest, result);
  assert.equal(result.status, "COMPLETED");
  const chunks = await db.aiKnowledgeChunk.findMany({ where: { knowledgeId: entry.id } });
  assert.ok(chunks.every((chunk) => chunk.content.includes("new policy") && !chunk.content.includes("old policy")));
  assert.equal((await knowledge.knowledgeIndexStats()).processing, 0);
}));

test("killing and restarting a real worker recovers the task without repeating tool side effects", { timeout: 45_000 }, () => fixture(async ({ db, conversation, enqueue, config }) => {
  const saved = await db.setting.findUnique({ where: { key: "ai" } });
  let holdFinal = true;
  let finalRequests = 0;
  const processes = [];
  let workerOutput = "";
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    const hasResults = input.messages.some((message) => message.role === "tool");
    if (hasResults) {
      finalRequests += 1;
      if (holdFinal) return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: hasResults ? { content: "A human will help you." } : {
      content: null, tool_calls: [
        { id: randomUUID(), type: "function", function: { name: "escalate_to_human", arguments: JSON.stringify({ reason: holdFinal ? "first reason" : "retry reason", priority: holdFinal ? 3 : 1 }) } },
        { id: randomUUID(), type: "function", function: { name: "tag_conversation", arguments: '{"tags":["urgent"]}' } },
      ],
    } }] }));
  });
  const launch = () => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      'import { startAiWorker } from "./src/server/ai-worker.ts"; startAiWorker(); setInterval(() => {}, 1000);'],
    { cwd: process.cwd(), env: { ...process.env, NODE_ENV: "test", DATABASE_URL: process.env.TEST_DATABASE_URL, REDIS_URL: "" }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (data) => { workerOutput += data; });
    child.stderr.on("data", (data) => { workerOutput += data; });
    processes.push(child);
    return child;
  };
  const stop = async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
  };
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const settings = { ...config, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, enableTools: true };
    await db.setting.upsert({ where: { key: "ai" }, create: { key: "ai", value: settings }, update: { value: settings } });
    await enqueue();
    const first = launch();
    await eventually(() => finalRequests === 1);
    assert.equal(await db.aiToolEffect.count({ where: { messageId: conversation.messages[0].id } }), 2);
    await stop(first);
    holdFinal = false;
    await db.aiJob.update({ where: { conversationId: conversation.id }, data: { lockedUntil: new Date(0) } });
    launch();
    await eventually(async () => (await db.aiJob.findUnique({ where: { conversationId: conversation.id } }))?.status === "COMPLETED");
    assert.equal(await db.message.count({ where: { conversationId: conversation.id, sender: "AI" } }), 1);
    assert.equal(await db.message.count({ where: { conversationId: conversation.id, type: "NOTE" } }), 1);
    assert.equal(await db.aiToolEffect.count({ where: { messageId: conversation.messages[0].id } }), 2);
    assert.equal((await db.conversation.findUnique({ where: { id: conversation.id } })).priority, 3);
    assert.equal(finalRequests, 2);
  } catch (error) {
    error.message += `\nWorker output: ${workerOutput.slice(-3000)}`;
    throw error;
  } finally {
    for (const child of processes) await stop(child);
    await closeTestServer(server);
    await restoreSetting(db, "ai", saved);
  }
}));
