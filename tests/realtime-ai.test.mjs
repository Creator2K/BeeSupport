import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadAiModule,
  loadAiService,
  loadAiToolsModule,
  loadModule,
  loadSocketModule,
  auth,
  nextTurn,
} from "./load-module.mjs";

const lock = loadModule("src/server/transactions.ts");
const aiHelpers = loadAiModule();

function aiFixture() {
  const state = {
    latest: {
      id: "v1",
      sender: "VISITOR",
      type: "TEXT",
      body: "Question",
      authorName: null,
    },
    lease: "token",
    leaseExpiry: new Date(Date.now() + 60_000),
    revision: 1,
    inserted: [],
    pending: [],
    modelCalls: 0,
  };
  const config = {
    ...aiHelpers.defaultAiConfig(),
    enabled: true,
    apiKey: "mock",
    model: "mock",
    autoReply: "always",
    enableTools: false,
  };
  const prisma = {
    $queryRaw: async (_query, ...values) => values[0] === "reply:c1" && values[1] === state.revision && values[2] === state.lease && state.leaseExpiry > new Date() ? [{ id: "reply:c1" }] : [],
    $transaction: async (callback) => callback(prisma),
    aiJob: {
      update: async () => ({}),
      findFirst: async ({ where }) => where.id === "reply:c1" && where.revision === state.revision && where.leaseToken === state.lease && state.leaseExpiry > new Date() ? { id: "reply:c1" } : null,
    },
    conversation: {
      findUnique: async () => ({
        id: "c1",
        siteId: "s1",
        visitorId: "visitor",
        status: state.status ?? "OPEN",
        tags: [],
        aiReplyToken: state.lease,
        aiReplyExpiresAt: state.leaseExpiry,
        site: {
          name: "Shop",
          active: state.siteActive !== false,
          tenant: {
            status: state.tenantStatus ?? "ACTIVE",
            expiresAt: state.tenantExpiry ?? null,
            features: { ai: state.aiAllowed !== false, removeBranding: true, advancedAnalytics: true },
          },
        },
        visitor: { blocked: state.blocked ?? false },
        messages: [state.latest],
      }),
      updateMany: async ({ where, data }) => {
        if (where.OR && state.lease) return { count: 0 };
        if (where.aiReplyToken && where.aiReplyToken !== state.lease)
          return { count: 0 };
        state.lease = data.aiReplyToken;
        state.leaseExpiry = data.aiReplyExpiresAt;
        return { count: 1 };
      },
      update: async () => ({}),
    },
    message: {
      findFirst: async ({ where }) =>
        where.sender === "AGENT"
          ? state.latest.sender === "AGENT"
            ? state.latest
            : null
          : state.latest,
      findMany: async () => [state.latest],
      create: async ({ data }) => {
        const message = { id: `ai${state.inserted.length + 1}`, ...data };
        state.inserted.push(message);
        state.latest = message;
        return message;
      },
    },
  };
  const dependencies = {
    "./entitlements": {
      getSiteFeatures: async () => ({ ai: state.aiAllowed !== false }),
    },
    "../../lib/ai": {
      ...aiHelpers,
      getAiConfig: async () => config,
      retrieveKnowledge: async () => [],
      chatCompletion: () => {
        state.modelCalls += 1;
        return new Promise((resolve) =>
          state.pending.push(() =>
            resolve({ content: "Answer", toolCalls: [], usage: null }),
          ),
        );
      },
    },
    "./ai-policy": {
      resolveAiPolicyForSite: async () => ({
        tenantId: "t1",
        siteName: "Shop",
        policy: {
          enabled: config.enabled && state.aiAllowed !== false,
          config,
          autoReply: config.autoReply,
          allowMutations: true,
          monthlyRequestLimit: null,
          monthlyTokenLimit: null,
          requestLimitScope: "tenant",
          tokenLimitScope: "tenant",
          concurrencyLimit: 2,
          overLimitAction: "skip",
        },
      }),
    },
    "./ai-usage": {
      checkAiQuota: async () => ({ ok: true }),
      recordAiUsage: async () => {},
    },
    "../../lib/auth": auth,
    "../../lib/db": { prisma },
    "../../lib/visitor-env": {},
    "./broadcast": {
      broadcastMessage: async () => {},
      broadcastConversation: async () => {},
    },
    "../transactions": lock,
  };
  dependencies["./ai-tools"] = loadAiToolsModule(dependencies);
  const module = () => loadAiService(dependencies);
  const waitForCalls = async (count) => {
    for (let spin = 0; spin < 50 && state.modelCalls < count; spin += 1)
      await nextTurn();
    assert.equal(state.modelCalls, count);
  };
  const job = () => ({ id: "reply:c1", kind: "AUTO_REPLY", conversationId: "c1", messageId: state.latest.id, leaseToken: state.lease, revision: state.revision, attempts: 1 });
  return { state, config, dependencies, service: module(), module, waitForCalls, job };
}

test("disabled plan AI blocks draft and automatic replies without calling the model", async () => {
  const { state, service, job } = aiFixture();
  state.aiAllowed = false;
  assert.equal((await service.decideAutoReply("c1")).reply, false);
  await service.processAutoReply(job());
  await assert.rejects(
    service.suggestAgentReply({
      user: { siteIds: ["s1"] },
      conversationId: "c1",
    }),
    { status: 403 },
  );
  assert.equal(state.modelCalls, 0);
});
test("an in-flight AI reply is discarded when the plan grant is revoked", async () => {
  const { state, service, waitForCalls, job } = aiFixture();
  const pending = service.processAutoReply(job());
  await waitForCalls(1);
  state.aiAllowed = false;
  state.pending.shift()();
  await pending;
  assert.equal(state.inserted.length, 0);
});
test("a worker whose lease was replaced cannot start model generation", async () => {
  const { state, service, job } = aiFixture();
  const stale = job();
  state.lease = "new-owner";
  assert.equal((await service.processAutoReply(stale)).status, "SKIPPED");
  assert.equal(state.modelCalls, 0);
});

test("an AI response generated before a human reply is discarded", async () => {
  const { state, service, waitForCalls, job } = aiFixture();
  const pending = service.processAutoReply(job());
  await waitForCalls(1);
  state.latest = {
    id: "human",
    sender: "AGENT",
    type: "TEXT",
    body: "Handled",
  };
  state.pending.shift()();
  await pending;
  assert.equal(state.inserted.length, 0);
  assert.equal(state.modelCalls, 1);
});

test("a newer visitor message supersedes an in-flight AI answer", async () => {
  const { state, service, waitForCalls, job } = aiFixture();
  const pending = service.processAutoReply(job());
  await waitForCalls(1);
  state.latest = {
    id: "v2",
    sender: "VISITOR",
    type: "TEXT",
    body: "Updated question",
  };
  state.revision += 1;
  state.pending.shift()();
  assert.equal((await pending).status, "SKIPPED");
  const replacement = service.processAutoReply(job());
  await waitForCalls(2);
  assert.equal(state.inserted.length, 0);
  state.pending.shift()();
  await replacement;
  assert.equal(state.inserted.length, 1);
});

for (const [label, patch] of [
  ["site disabled", { siteActive: false }],
  ["tenant suspended", { tenantStatus: "SUSPENDED" }],
  ["tenant expired", { tenantExpiry: new Date(0) }],
  ["visitor blocked", { blocked: true }],
  ["conversation closed", { status: "CLOSED" }],
]) {
  test(`AI discards in-flight answers and denies tools after ${label}`, async () => {
    const { state, config, dependencies, service, waitForCalls, job } = aiFixture();
    config.enableTools = true;
    const pending = service.processAutoReply(job());
    await waitForCalls(1);
    Object.assign(state, patch);
    const context = { conversationId: "c1", siteId: "s1", visitorId: "visitor", config: { ...config, enableTools: true }, allowMutations: true, expectedMessageId: "v1", leaseToken: state.lease, trace: [] };
    const tools = dependencies["./ai-tools"];
    for (const name of ["get_visitor_context", "tag_conversation", "escalate_to_human"]) {
      assert.match(await tools.runTool(context, { name, arguments: '{"tags":["test"]}' }), /不可执行/);
    }
    state.pending.shift()();
    await pending;
    assert.equal(state.inserted.length, 0);
    assert.equal(state.modelCalls, 1);
  });
}

test("expired leases and mismatched associations cannot insert AI messages", async () => {
  const { state, service } = aiFixture();
  state.lease = "token";
  state.leaseExpiry = new Date(0);
  const input = { conversationId: "c1", siteId: "s1", body: "answer", authorName: "AI", leaseToken: "token", expectedMessageId: "v1" };
  assert.equal(await service.insertAiMessage(input), null);
  state.leaseExpiry = new Date(Date.now() + 60_000);
  assert.equal(await service.insertAiMessage({ ...input, siteId: "another-site" }), null);
  assert.equal(await service.insertAiMessage({ ...input, leaseToken: "old-token" }), null);
  assert.equal(state.inserted.length, 0);
});

test("disabled AI blocks agent drafts before calling the model", async () => {
  const { config, service, state } = aiFixture();
  config.enabled = false;
  await assert.rejects(service.suggestAgentReply({ user: { siteIds: ["s1"] }, conversationId: "c1" }), /启用/);
  assert.equal(state.modelCalls, 0);
});

test("broadcast failure preserves the committed AI message and still attempts the other notification", async () => {
  const { state, dependencies, module } = aiFixture();
  let notified = false;
  dependencies["./broadcast"].broadcastMessage = async () => { throw new Error("realtime offline"); };
  dependencies["./broadcast"].broadcastConversation = async () => { notified = true; };
  const id = await module().insertAiMessage({ conversationId: "c1", siteId: "s1", body: "answer", authorName: "AI" });
  assert.equal(id, state.inserted[0].id);
  assert.equal(notified, true);
  assert.equal(state.inserted.length, 1);
});

async function socketFixture({ anonymous = false } = {}) {
  const state = {
    enabled: !anonymous,
    typed: [],
    disconnected: false,
    resolveCalls: 0,
    conversationLookups: 0,
  };
  const current = {
    id: "a1",
    siteIds: ["s1"],
    role: "AGENT",
    status: "ONLINE",
    name: "Agent",
  };
  const events = new Map();
  let authenticate;
  let connect;
  let packetMiddleware;
  const socket = {
    id: "socket1",
    connected: true,
    handshake: { headers: { cookie: "session=valid" }, auth: {} },
    data: {},
    join: async () => {},
    leave: async () => {},
    emit: () => {},
    use: (fn) => {
      packetMiddleware = fn;
    },
    on: (event, fn) => events.set(event, fn),
    disconnect: () => {
      if (!socket.connected) return;
      socket.connected = false;
      state.disconnected = true;
      events.get("disconnect")?.();
    },
  };
  const io = {
    use: (fn) => {
      authenticate = fn;
    },
    on: (_event, fn) => {
      connect = fn;
    },
    in: () => ({ fetchSockets: async () => [] }),
  };
  const previousIdentityTtl = process.env.SOCKET_IDENTITY_TTL_MS;
  const previousConversationTtl = process.env.SOCKET_CONVERSATION_TTL_MS;
  process.env.SOCKET_IDENTITY_TTL_MS = "50";
  process.env.SOCKET_CONVERSATION_TTL_MS = "50";
  const module = loadSocketModule({
    "../lib/auth": {
      ...auth,
      SESSION_COOKIE: "session",
      resolveUserFromToken: async () => {
        state.resolveCalls += 1;
        return state.enabled ? current : null;
      },
    },
    "../lib/db": {
      prisma: {
        user: {
          update: async () => ({ status: "ONLINE" }),
          updateMany: async () => ({ count: 1 }),
        },
        conversation: {
          findUnique: async ({ where }) => {
            state.conversationLookups += 1;
            return {
              id: where.id,
              siteId: where.id === "own" ? "s1" : "s2",
              visitorId: "v1",
            };
          },
        },
      },
    },
    "../lib/realtime/emit": {
      setIo() {},
      emitAgentPresence() {},
      emitVisitorPresence() {},
      agentSessionRoom: () => "session-room",
      emitTyping: (payload) => state.typed.push(payload),
    },
    "../lib/realtime/rooms": {
      rooms: {
        agent: (id) => id,
        allAgents: () => "all",
        tenantAgents: (id) => `tenant:${id}`,
        tenantAdmins: (id) => `tenant:${id}:admins`,
        siteAgents: (id) => id,
        visitor: (id) => id,
        conversation: (id) => id,
      },
    },
    "../lib/visitor-auth": { verifyVisitorToken: async () => null },
    "./client-ip": loadModule("src/server/client-ip.ts"),
    "./services/risk": { assertIpAllowed: async () => {} },
    "../lib/rate-limit": { rateLimit: async () => ({ ok: true }) },
    "./presence": {
      addAgentSocket: async () => 1,
      removeAgentSocket: async () => 0,
      markVisitorOnline: async () => {},
      markVisitorOffline: async () => {},
    },
    "./ttl-cache": loadModule("src/server/ttl-cache.ts"),
  });
  if (previousIdentityTtl === undefined)
    delete process.env.SOCKET_IDENTITY_TTL_MS;
  else process.env.SOCKET_IDENTITY_TTL_MS = previousIdentityTtl;
  if (previousConversationTtl === undefined)
    delete process.env.SOCKET_CONVERSATION_TTL_MS;
  else process.env.SOCKET_CONVERSATION_TTL_MS = previousConversationTtl;
  module.registerRealtime(io);
  const established = new Promise((resolve, reject) =>
    authenticate(socket, (error) => (error ? reject(error) : resolve())),
  );
  if (anonymous) {
    await assert.rejects(established, /Unauthorized/);
    return { state };
  }
  await established;
  connect(socket);
  await nextTurn();
  const send = async (event, payload) => {
    await new Promise((resolve, reject) =>
      packetMiddleware([event, payload], (error) =>
        error ? reject(error) : resolve(),
      ),
    );
    events.get(event)(payload);
    await nextTurn();
  };
  return { state, send, close: () => socket.disconnect() };
}

test("anonymous sockets are rejected before joining any room", async () => {
  await socketFixture({ anonymous: true });
});

test("typing caches identity and conversation access, then rechecks revocation", async () => {
  const { state, send, close } = await socketFixture();
  try {
    const initialResolveCalls = state.resolveCalls;
    const initialLookups = state.conversationLookups;

    await send("typing", { conversationId: "other", isTyping: true });
    assert.equal(state.typed.length, 0);
    assert.equal(state.conversationLookups, initialLookups + 1);
    assert.equal(state.resolveCalls, initialResolveCalls);

    await send("typing", { conversationId: "own", isTyping: true });
    assert.equal(state.typed.length, 1);
    assert.equal(state.conversationLookups, initialLookups + 2);

    const cachedLookups = state.conversationLookups;
    await send("typing", { conversationId: "own", isTyping: false });
    assert.equal(state.typed.length, 2);
    assert.equal(state.conversationLookups, cachedLookups);
    assert.equal(state.resolveCalls, initialResolveCalls);

    await new Promise((resolve) => setTimeout(resolve, 80));
    state.enabled = false;
    await assert.rejects(
      send("typing", { conversationId: "own", isTyping: true }),
      /Unauthorized/,
    );
    assert.equal(state.typed.length, 2);
    assert.equal(state.disconnected, true);
  } finally {
    close();
  }
});
