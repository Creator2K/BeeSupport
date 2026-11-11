import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auth,
  loadModule,
  loadSocketModule,
  nextTurn,
} from "./load-module.mjs";

const memoryLimiter = () =>
  loadModule("src/lib/rate-limit.ts", { "./redis": { getRedis: () => null } });

/**
 * Connects one socket through the real realtime modules. It belongs to agent
 * "a1", or to a visitor when `visitorId` is given. Sockets that share a
 * `limiter` share its counters, like connections to one server process.
 */
async function connect({ limiter, state, socketId, visitorId }) {
  const events = new Map();
  let authenticate;
  let onConnection;
  let packetMiddleware;
  const socket = {
    id: socketId,
    connected: true,
    handshake: {
      headers: { cookie: "session=valid" },
      auth: visitorId ? { token: "visitor-token" } : {},
    },
    request: { socket: { remoteAddress: "203.0.113.5" } },
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
      events.get("disconnect")?.();
    },
  };
  const io = {
    use: (fn) => {
      authenticate = fn;
    },
    on: (_event, fn) => {
      onConnection = fn;
    },
    in: () => ({ fetchSockets: async () => [] }),
  };
  const module = loadSocketModule({
    "../lib/auth": {
      ...auth,
      SESSION_COOKIE: "session",
      resolveUserFromToken: async () => ({
        id: "a1",
        siteIds: ["s1"],
        role: "AGENT",
        status: "ONLINE",
        name: "Agent",
        tenantId: "t1",
      }),
    },
    "../lib/db": {
      prisma: {
        user: {
          update: async ({ data }) => {
            if (data.status) state.statusWrites.push(data.status);
            return { status: "ONLINE" };
          },
          updateMany: async () => ({ count: 1 }),
        },
        conversation: {
          findUnique: async ({ where }) => {
            state.lookups += 1;
            return { id: where.id, siteId: "s1", visitorId: "v1" };
          },
        },
      },
    },
    "../lib/realtime/emit": {
      setIo() {},
      emitAgentPresence: (_id, status) => state.broadcasts.push(status),
      emitVisitorPresence() {},
      agentSessionRoom: () => "session-room",
      emitTyping() {},
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
    "../lib/visitor-auth": {
      verifyVisitorToken: async () =>
        visitorId ? { visitorId, siteId: "s1" } : null,
    },
    "./client-ip": loadModule("src/server/client-ip.ts"),
    "./services/risk": { assertIpAllowed: async () => {} },
    "../lib/rate-limit": limiter,
    "./presence": {
      addAgentSocket: async () => 1,
      removeAgentSocket: async () => 0,
      markVisitorOnline: async () => {},
      markVisitorOffline: async () => {},
    },
    "./ttl-cache": loadModule("src/server/ttl-cache.ts"),
  });
  module.registerRealtime(io);
  await new Promise((resolve, reject) =>
    authenticate(socket, (error) => (error ? reject(error) : resolve())),
  );
  onConnection(socket);
  await nextTurn();
  /** Delivers one client event and resolves with the acknowledgement, if any. */
  const send = async (event, payload) => {
    await new Promise((resolve, reject) =>
      packetMiddleware([event, payload], (error) =>
        error ? reject(error) : resolve(),
      ),
    );
    let acknowledgement;
    events.get(event)(payload, (result) => {
      acknowledgement = result;
    });
    await nextTurn();
    return acknowledgement;
  };
  return { send, close: () => socket.disconnect() };
}

const freshState = () => ({ lookups: 0, statusWrites: [], broadcasts: [] });

test("joining conversations is limited per identity, not per connection", async () => {
  const limiter = memoryLimiter();
  const state = freshState();
  const first = await connect({ limiter, state, socketId: "socket-1" });
  const second = await connect({ limiter, state, socketId: "socket-2" });
  const visitor = await connect({
    limiter,
    state,
    socketId: "socket-3",
    visitorId: "v1",
  });
  try {
    for (let index = 0; index < 30; index += 1)
      assert.deepEqual(
        await first.send("conversation:join", { conversationId: `c${index}` }),
        { ok: true },
      );
    assert.equal(state.lookups, 30);

    const refused = await first.send("conversation:join", {
      conversationId: "c-next",
    });
    assert.equal(refused.ok, false);
    assert.match(refused.error, /频繁/);
    // A second connection of the same agent does not get a fresh allowance,
    // and a refused join does not reach the database.
    assert.equal(
      (await second.send("conversation:join", { conversationId: "c-other" }))
        .ok,
      false,
    );
    assert.equal(state.lookups, 30);

    // Someone else is unaffected.
    assert.deepEqual(
      await visitor.send("conversation:join", { conversationId: "c-visitor" }),
      { ok: true },
    );
  } finally {
    first.close();
    second.close();
    visitor.close();
  }
});

test("presence changes over the socket stop being written and broadcast past the limit", async () => {
  const limiter = memoryLimiter();
  const state = freshState();
  const agent = await connect({ limiter, state, socketId: "socket-1" });
  try {
    // Connecting already wrote and announced the agent's status once.
    const writes = state.statusWrites.length;
    const broadcasts = state.broadcasts.length;

    // Values that are not a status change nothing and use no allowance.
    for (let index = 0; index < 20; index += 1)
      await agent.send("agent:status", { status: "BOGUS" });
    assert.equal(state.statusWrites.length, writes);

    for (let index = 0; index < 10; index += 1)
      await agent.send("agent:status", {
        status: index % 2 ? "ONLINE" : "AWAY",
      });
    assert.equal(state.statusWrites.length, writes + 10);
    assert.equal(state.broadcasts.length, broadcasts + 10);

    await agent.send("agent:status", { status: "OFFLINE" });
    assert.equal(state.statusWrites.length, writes + 10);
    assert.equal(state.broadcasts.length, broadcasts + 10);
    assert.equal(state.statusWrites.at(-1), "ONLINE");
  } finally {
    agent.close();
  }
});
