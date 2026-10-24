import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadAiModule,
  loadAiService,
  loadModule,
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
    lease: null,
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
    $queryRaw: async () => [],
    $transaction: async (callback) => callback(prisma),
    conversation: {
      findUnique: async () => ({
        id: "c1",
        siteId: "s1",
        visitorId: "visitor",
        status: "OPEN",
        aiReplyToken: state.lease,
        site: { name: "Shop" },
        messages: [state.latest],
      }),
      updateMany: async ({ where, data }) => {
        if (where.OR && state.lease) return { count: 0 };
        if (where.aiReplyToken && where.aiReplyToken !== state.lease)
          return { count: 0 };
        state.lease = data.aiReplyToken;
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
    "../../lib/auth": auth,
    "../../lib/db": { prisma },
    "../../lib/visitor-env": {},
    "./broadcast": {
      broadcastMessage: async () => {},
      broadcastConversation: async () => {},
    },
    "../transactions": lock,
  };
  dependencies["./ai-tools"] = loadModule(
    "src/server/services/ai-tools.ts",
    dependencies,
  );
  const module = () => loadAiService(dependencies);
  const waitForCalls = async (count) => {
    for (let spin = 0; spin < 50 && state.modelCalls < count; spin += 1)
      await nextTurn();
    assert.equal(state.modelCalls, count);
  };
  return { state, service: module(), module, waitForCalls };
}

test("disabled plan AI blocks draft and automatic replies without calling the model", async () => {
  const { state, service } = aiFixture();
  state.aiAllowed = false;
  assert.equal((await service.decideAutoReply("c1")).reply, false);
  await service.maybeAutoReply("c1");
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
  const { state, service, waitForCalls } = aiFixture();
  const pending = service.maybeAutoReply("c1");
  await waitForCalls(1);
  state.aiAllowed = false;
  state.pending.shift()();
  await pending;
  assert.equal(state.inserted.length, 0);
});
test("concurrent AI triggers across instances call the model once", async () => {
  const { state, service, module, waitForCalls } = aiFixture();
  const first = service.maybeAutoReply("c1");
  const retry = service.maybeAutoReply("c1");
  const otherInstance = module();
  await otherInstance.maybeAutoReply("c1");
  await waitForCalls(1);
  state.pending.shift()();
  await Promise.all([first, retry]);
  assert.equal(state.modelCalls, 1);
  assert.equal(state.inserted.length, 1);
  assert.equal(state.lease, null);
});

test("an AI response generated before a human reply is discarded", async () => {
  const { state, service, waitForCalls } = aiFixture();
  const pending = service.maybeAutoReply("c1");
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
  const { state, service, waitForCalls } = aiFixture();
  const pending = service.maybeAutoReply("c1");
  await waitForCalls(1);
  state.latest = {
    id: "v2",
    sender: "VISITOR",
    type: "TEXT",
    body: "Updated question",
  };
  state.pending.shift()();
  await waitForCalls(2);
  assert.equal(state.inserted.length, 0);
  state.pending.shift()();
  await pending;
  assert.equal(state.inserted.length, 1);
  assert.equal(state.lease, null);
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
  const module = loadModule("src/server/socket.ts", {
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
