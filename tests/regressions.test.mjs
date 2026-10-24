import { test } from "node:test";
import assert from "node:assert/strict";

import {
  auth,
  loadAiModule,
  loadConversationService,
  loadModule,
  nextTurn,
  tenants,
} from "./load-module.mjs";
import {
  restoreSetting,
  useTestDatabase,
} from "../scripts/test-environment.mjs";

const publicData = loadModule("src/lib/realtime/public.ts");
const { mergeMessages, mergeMessageSnapshot, snapshotHasOlderMessages } =
  loadModule("src/lib/realtime/messages.ts");
const { isWithinWorkHours } = loadModule("src/lib/work-hours.ts");
const locks = loadModule("src/server/transactions.ts");
const fixture = () => ({
  id: "c1",
  siteId: "s1",
  visitorId: "v1",
  status: "PENDING",
  assignedAgentId: null,
  firstResponseAt: null,
  unreadForAgent: 0,
  unreadForVisitor: 0,
  site: {
    name: "Shop",
    tenantId: "tenant1",
    active: true,
    tenant: { status: "ACTIVE", expiresAt: null },
  },
  visitor: { email: "v@example.com" },
});

function messageStore() {
  const state = {
    conversation: fixture(),
    messages: [],
    attachments: [],
    reminders: [],
    failResolve: false,
  };
  let queue = Promise.resolve();
  const tx = {
    $queryRaw: async () => [],
    conversation: {
      findUnique: async () => state.conversation,
      update: async ({ data }) => {
        for (const [key, value] of Object.entries(data))
          state.conversation[key] =
            value && typeof value === "object" && "increment" in value
              ? (state.conversation[key] ?? 0) + value.increment
              : value;
        return state.conversation;
      },
    },
    message: {
      findUnique: async ({ where }) =>
        state.messages.find(
          (item) =>
            item.conversationId ===
              where.conversationId_clientId.conversationId &&
            item.clientId === where.conversationId_clientId.clientId,
        ) ?? null,
      create: async ({ data }) => {
        const message = {
          id: `m${state.messages.length + 1}`,
          createdAt: new Date(),
          ...data,
        };
        state.messages.push(message);
        return message;
      },
      updateMany: async ({ where, data }) => {
        for (const message of state.messages)
          if (message.conversationId === where.conversationId)
            Object.assign(message, data);
        return { count: state.messages.length };
      },
    },
    attachment: {
      count: async () => state.attachments.length,
      updateMany: async ({ where, data }) => {
        const rows = state.attachments.filter(
          (row) =>
            where.id.in.includes(row.id) &&
            row.siteId === where.siteId &&
            row.uploader === where.uploader &&
            row.uploaderId === where.uploaderId &&
            row.messageId === null,
        );
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
    },
    unansweredReminder: {
      updateMany: async ({ data }) => {
        if (state.failResolve) throw Error("reminder resolution unavailable");
        state.reminders.forEach((row) => {
          if (!row.resolvedAt) Object.assign(row, data);
        });
        return { count: state.reminders.length };
      },
    },
  };
  const prisma = {
    ...tx,
    $transaction(callback) {
      const work = queue.then(async () => {
        const snapshot = structuredClone(state);
        try {
          return await callback(tx);
        } catch (error) {
          Object.assign(state, snapshot);
          throw error;
        }
      });
      queue = work.catch(() => undefined);
      return work;
    },
  };
  const service = loadModule("src/server/services/messages.ts", {
    "./tenants": tenants,
    "../../lib/auth": auth,
    "../../lib/db": { prisma },
    "../../lib/realtime/emit": { emitRead() {} },
    "../../lib/realtime/public": publicData,
    "../transactions": locks,
    "../serialize": {
      messageInclude: { attachments: true },
      serializeMessage: (message) => message,
    },
    "./broadcast": {
      broadcastMessage: async () => {},
      broadcastConversation: async () => {},
    },
    "./ai": { maybeAutoReply: async () => {} },
    "./notifications": { notifyVisitorMessage: async () => {} },
  });
  return { service, state, prisma };
}

test("overnight shifts belong to the day they start, including the Sunday boundary", () => {
  const hours = {
    enabled: true,
    timezone: "UTC",
    days: { 1: [["22:00", "02:00"]], 0: [["23:00", "00:30"]] },
  };
  assert.equal(
    isWithinWorkHours(hours, new Date("2026-10-19T01:00:00Z")),
    false,
  );
  assert.equal(
    isWithinWorkHours(hours, new Date("2026-10-19T00:15:00Z")),
    true,
  );
  assert.equal(
    isWithinWorkHours(hours, new Date("2026-10-19T22:00:00Z")),
    true,
  );
  assert.equal(
    isWithinWorkHours(hours, new Date("2026-10-20T01:59:00Z")),
    true,
  );
  assert.equal(
    isWithinWorkHours(hours, new Date("2026-10-20T02:00:00Z")),
    false,
  );
});

test("public conversations and messages do not expose internal fields", () => {
  const conversation = {
    ...fixture(),
    note: "secret",
    tags: ["internal"],
    priority: 3,
    visitor: {
      id: "v1",
      email: "v@example.com",
      name: "V",
      meta: { ip: "private" },
    },
    assignedAgent: {
      id: "a1",
      name: "Agent",
      email: "private@example.com",
      avatarUrl: null,
    },
  };
  const result = publicData.visitorConversation(conversation);
  assert.equal("note" in result, false);
  assert.equal("tags" in result, false);
  assert.equal("priority" in result, false);
  assert.deepEqual(result.assignedAgent, { name: "Agent", avatarUrl: null });
  assert.equal("meta" in result.visitor, false);
  assert.equal(
    publicData.visitorMessage({
      authorId: "a1",
      meta: { ai: { tools: ["private"] } },
    }).meta,
    null,
  );
});

test("visitor broadcasts use the public shape and never include NOTE messages", () => {
  const sent = [];
  const rooms = {
    admins: () => "admins",
    tenantAdmins: (id) => `tenant:${id}:admins`,
    siteAgents: (id) => `site:${id}`,
    visitor: (id) => `visitor:${id}`,
  };
  const emit = loadModule("src/lib/realtime/emit.ts", {
    "../db": { prisma: {} },
    "./rooms": { rooms },
    "./public": publicData,
  });
  emit.setIo({
    to: (room) => ({
      emit: (event, payload) => sent.push({ room, event, payload }),
    }),
  });
  const conversation = {
    ...fixture(),
    visitor: { id: "v1" },
    note: "secret",
    assignedAgent: null,
  };
  emit.emitMessage({
    conversationId: "c1",
    conversation,
    message: { type: "NOTE", body: "private" },
  });
  assert.deepEqual(
    sent.map((item) => item.room),
    [["site:s1", "tenant:legacy:admins", "admins"]],
  );
  sent.length = 0;
  emit.emitConversationUpdated(conversation);
  assert.equal(
    "note" in
      sent.find((item) => item.room === "visitor:v1").payload.conversation,
    false,
  );
});

test("a different site's agent cannot clear read receipts or counters", async () => {
  const { service, state } = messageStore();
  state.conversation.unreadForAgent = 4;
  await assert.rejects(
    service.markConversationRead({
      conversationId: "c1",
      by: "AGENT",
      user: { siteIds: ["other-site"] },
    }),
    { status: 403 },
  );
  assert.equal(state.conversation.unreadForAgent, 4);
});

test("attachment ownership failures roll back message creation and unread counts", async () => {
  const { service, state } = messageStore();
  state.attachments.push({
    id: "f1",
    siteId: "s1",
    uploader: "VISITOR",
    uploaderId: "someone-else",
    messageId: null,
  });
  await assert.rejects(
    service.insertMessage({
      conversationId: "c1",
      siteId: "s1",
      sender: "VISITOR",
      uploaderId: "v1",
      body: "",
      attachmentIds: ["f1"],
    }),
    { status: 400 },
  );
  assert.equal(state.messages.length, 0);
  assert.equal(state.conversation.unreadForAgent, 0);
  assert.equal(state.attachments[0].messageId, null);
});

test("visitor bursts keep their original waiting round, reads and notes do not end it, and public replies do", async () => {
  const { service, state } = messageStore();
  const visitor = {
    conversationId: "c1",
    siteId: "s1",
    sender: "VISITOR",
    body: "等待回复",
    uploaderId: "v1",
  };
  const first = await service.insertMessage(visitor),
    since = state.conversation.waitingSince;
  await service.insertMessage({ ...visitor, body: "补充说明" });
  assert.equal(state.conversation.waitingMessageId, first);
  assert.equal(state.conversation.waitingSince, since);
  await service.markConversationRead({
    conversationId: "c1",
    by: "AGENT",
    user: { siteIds: ["s1"] },
  });
  await service.postInternalNote({
    conversationId: "c1",
    user: { id: "agent", siteIds: ["s1"] },
    body: "内部处理备注",
  });
  assert.equal(state.conversation.waitingMessageId, first);
  state.reminders.push({ resolvedAt: null });
  await service.insertMessage({
    conversationId: "c1",
    siteId: "s1",
    sender: "AGENT",
    body: "人工答复",
  });
  assert.equal(state.conversation.waitingMessageId, null);
  assert.equal(state.conversation.waitingSince, null);
  assert.equal(state.reminders[0].resolution, "REPLIED");
  const next = await service.insertMessage(visitor);
  assert.equal(state.conversation.waitingMessageId, next);
  assert.notEqual(next, first);
});

test("failed reminder resolution rolls back a public reply and preserves the waiting round", async () => {
  const { service, state } = messageStore();
  await service.insertMessage({
    conversationId: "c1",
    siteId: "s1",
    sender: "VISITOR",
    body: "等待答复",
    uploaderId: "v1",
  });
  const first = state.conversation.waitingMessageId;
  state.failResolve = true;
  await assert.rejects(
    service.insertMessage({
      conversationId: "c1",
      siteId: "s1",
      sender: "AGENT",
      body: "人工答复",
    }),
    /reminder resolution unavailable/,
  );
  assert.equal(state.messages.length, 1);
  assert.equal(state.conversation.waitingMessageId, first);
});

test("concurrent retries create one message and increment unread once", async () => {
  const { service, state } = messageStore();
  const input = {
    conversationId: "c1",
    siteId: "s1",
    sender: "VISITOR",
    body: "Hello",
    clientId: "retry-key",
    uploaderId: "v1",
  };
  const ids = await Promise.all([
    service.insertMessage(input),
    service.insertMessage(input),
    service.insertMessage(input),
  ]);
  assert.equal(new Set(ids).size, 1);
  assert.equal(state.messages.length, 1);
  assert.equal(state.conversation.unreadForAgent, 1);
  await nextTurn();
});

test("resending after a lost acknowledgement reuses the message, while an intentional repeat is new", async () => {
  const { service, state } = messageStore();
  const { prepareSendAttempt } = loadModule("src/lib/realtime/send-attempt.ts");
  let attempt = prepareSendAttempt(null, "c1", "Hello");
  const send = () =>
    service.insertMessage({
      conversationId: "c1",
      siteId: "s1",
      sender: "VISITOR",
      uploaderId: "v1",
      body: attempt.body,
      clientId: attempt.clientId,
    });
  await send(); // The server commits, but the caller loses the response.
  attempt = prepareSendAttempt(attempt, "c1", "Hello");
  await send();
  assert.equal(state.messages.length, 1);
  assert.equal(state.conversation.unreadForAgent, 1);
  attempt = prepareSendAttempt(null, "c1", "Hello"); // Acknowledged sends clear the attempt.
  await send();
  assert.equal(state.messages.length, 2);
  const changedConversation = prepareSendAttempt(attempt, "c2", "Hello");
  assert.notEqual(changedConversation.clientId, attempt.clientId);
  const edited = prepareSendAttempt(attempt, "c1", "Edited");
  assert.notEqual(edited.clientId, attempt.clientId);
});

test("latest history and before cursors return the correct chronological window", async () => {
  const rows = Array.from({ length: 205 }, (_, index) => ({
    id: `m${String(index).padStart(3, "0")}`,
    createdAt: new Date(index).toISOString(),
    type: "TEXT",
  }));
  const { service, prisma } = messageStore();
  prisma.message.findMany = async ({ orderBy, take, cursor }) => {
    assert.deepEqual(orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
    const all = [...rows].reverse();
    return all
      .slice(cursor ? all.findIndex((row) => row.id === cursor.id) + 1 : 0)
      .slice(0, take);
  };
  const latest = await service.listConversationMessages({
    conversationId: "c1",
  });
  assert.equal(latest.length, 200);
  assert.equal(latest[0].id, "m005");
  assert.equal(latest.at(-1).id, "m204");
  const previous = await service.listConversationMessages({
    conversationId: "c1",
    before: "m005",
  });
  assert.deepEqual(
    previous.map((row) => row.id),
    ["m000", "m001", "m002", "m003", "m004"],
  );
});

test("snapshot merging preserves live arrivals and replaces optimistic messages", () => {
  const message = (id, clientId, time) => ({ id, clientId, createdAt: time });
  const current = [
    message("old", null, "01"),
    message("tmp-retry", "retry", "02"),
    message("live", null, "04"),
  ];
  const result = mergeMessages(current, [message("confirmed", "retry", "03")]);
  assert.deepEqual(
    result.map((item) => item.id),
    ["old", "confirmed", "live"],
  );
});

test("a long disconnect restarts history at the latest window so missed pages remain reachable", () => {
  const current = [{ id: "old", createdAt: "001" }];
  const latest = Array.from({ length: 200 }, (_, index) => ({
    id: `new-${index}`,
    createdAt: `1${index}`,
  }));
  const result = mergeMessageSnapshot(current, latest);
  assert.equal(result.length, 200);
  assert.equal(
    result.some((message) => message.id === "old"),
    false,
  );
  assert.equal(result[0].id, "new-0");
  assert.equal(snapshotHasOlderMessages(current, latest, false), true);
});

test("polling preserves exhausted history until a disconnect actually creates a gap", () => {
  const history = Array.from({ length: 205 }, (_, index) => ({
    id: `m${index}`,
    createdAt: new Date(index).toISOString(),
  }));
  const snapshot = history.slice(-200);
  assert.equal(snapshotHasOlderMessages(history, snapshot, false), false);
  assert.equal(snapshotHasOlderMessages(history, snapshot, true), true);
  assert.equal(snapshotHasOlderMessages([], snapshot), true);
  assert.equal(snapshotHasOlderMessages([], history.slice(0, 5)), false);
});

test("test helpers refuse the application database and restore existing settings", async () => {
  const saved = process.env.TEST_DATABASE_URL;
  delete process.env.TEST_DATABASE_URL;
  assert.throws(useTestDatabase, /TEST_DATABASE_URL/);
  if (saved !== undefined) process.env.TEST_DATABASE_URL = saved;
  const calls = [];
  const prisma = {
    setting: {
      upsert: async (input) => calls.push(input),
      deleteMany: async (input) => calls.push(input),
    },
  };
  await restoreSetting(prisma, "ai", { value: { model: "original" } });
  assert.deepEqual(calls[0].update.value, { model: "original" });
  await restoreSetting(prisma, "smtp", null);
  assert.deepEqual(calls[1], { where: { key: "smtp" } });
});

test("knowledge retrieval caches bounded site data and invalidates on edits", async () => {
  let reads = 0;
  const entry = {
    id: "knowledge",
    updatedAt: new Date(),
    title: "Refund policy",
    content: "Refund within seven days",
    keywords: ["refund"],
    chunks: [],
  };
  const ai = loadAiModule({
    aiKnowledge: {
      findMany: async ({ select }) => {
        if (select.content) reads += 1;
        return [entry];
      },
    },
  });
  const request = { siteId: "s1", query: "refund", topK: 4 };
  assert.equal((await ai.retrieveKnowledge(request))[0].title, "Refund policy");
  await ai.retrieveKnowledge(request);
  assert.equal(reads, 1);
  entry.title = "Updated refund policy";
  ai.invalidateKnowledgeCache();
  assert.equal((await ai.retrieveKnowledge(request))[0].title, entry.title);
  assert.equal(reads, 2);
});

test("expired memory presence does not keep an abandoned agent online", async () => {
  const originalNow = Date.now;
  let now = 100_000;
  Date.now = () => now;
  try {
    const presence = loadModule("src/server/presence.ts", {
      "../lib/redis": { getRedis: () => null },
      "../lib/db": {},
      "../lib/realtime/emit": {},
    });
    assert.equal(await presence.addAgentSocket("a1", "tab1"), 1);
    now += 30_000;
    assert.equal(await presence.addAgentSocket("a1", "tab2"), 2);
    now += 65_000;
    assert.equal(await presence.removeAgentSocket("a1", "tab1"), 1);
    now += 30_000;
    assert.equal(await presence.removeAgentSocket("a1", "missing"), 0);
  } finally {
    Date.now = originalNow;
  }
});

test("knowledge moved out of a site's scope is not served from another instance's cache", async () => {
  let rows = [
    {
      id: "knowledge",
      updatedAt: new Date(),
      title: "Refund policy",
      content: "Refund within seven days",
      keywords: ["refund"],
      chunks: [],
    },
  ];
  const ai = loadAiModule({
    aiKnowledge: { findMany: async () => structuredClone(rows) },
  });
  const request = { siteId: "s1", query: "refund", topK: 4 };
  assert.equal((await ai.retrieveKnowledge(request)).length, 1);
  rows = [];
  assert.deepEqual(await ai.retrieveKnowledge(request), []);
});

test("the original agent can claim a conversation reopened by its visitor", async () => {
  const conversation = {
    ...fixture(),
    assignedAgentId: "a1",
    status: "PENDING",
  };
  let notifications = 0;
  const prisma = {
    $queryRaw: async () => [],
    conversation: {
      findUnique: async () => conversation,
      update: async ({ data }) => Object.assign(conversation, data),
    },
    message: { create: async () => ({ id: "system" }) },
  };
  prisma.$transaction = async (callback) => callback(prisma);
  const service = loadConversationService({
    "./tenants": tenants,
    "../../lib/auth": auth,
    "../../lib/db": { prisma },
    "../../lib/realtime/rooms": { rooms: { agent: (id) => id } },
    "../../lib/realtime/public": publicData,
    "../../lib/widget": {},
    "../presence": {},
    "../serialize": {
      conversationInclude: {},
      serializeConversation: (record) => record,
    },
    "./broadcast": {
      broadcastConversation: async () => conversation,
      broadcastMessage: async () => {},
    },
    "../transactions": locks,
    "./messages": { createSystemMessage: async () => {} },
    "./notifications": {
      notifyConversationAssigned: async () => {
        notifications += 1;
      },
    },
    "./visitors": {},
    "./follow-up-rules": {},
  });
  const result = await service.claimConversation(
    { id: "a1", name: "Agent", siteIds: ["s1"] },
    "c1",
  );
  assert.equal(result.status, "OPEN");
  assert.equal(notifications, 1);
});
