import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auth,
  loadConversationService,
  loadModule,
  nextTurn,
  tenants,
} from "./load-module.mjs";

const serializer = loadModule("src/server/serialize.ts");
const locks = loadModule("src/server/transactions.ts");
const agent = (id = "a1", siteIds = ["s1"]) => ({ id, name: id, siteIds });

function fixture() {
  const now = new Date();
  const state = {
    conversation: {
      id: "c1",
      siteId: "s1",
      visitorId: "v1",
      status: "PENDING",
      assignedAgentId: null,
      assignedAgent: null,
      source: "WIDGET",
      createdAt: now,
      lastMessageAt: now,
      firstResponseAt: null,
      closedAt: null,
      site: { name: "Shop" },
      visitor: {
        id: "v1",
        email: "visitor@example.com",
        firstSeenAt: now,
        lastSeenAt: now,
      },
    },
    timeline: [],
    assigned: 0,
    closed: 0,
  };
  const faults = { timeline: false, update: false, broadcast: false };
  let queue = Promise.resolve();
  const tx = {
    $queryRaw: async (strings) => {
      assert.match(strings.join("?"), /FOR UPDATE/);
    },
    conversation: {
      findUnique: async () => structuredClone(state.conversation),
      update: async ({ data }) => {
        if (faults.update) throw new Error("database unavailable");
        Object.assign(state.conversation, data);
        if (data.assignedAgentId)
          state.conversation.assignedAgent = {
            id: data.assignedAgentId,
            name: data.assignedAgentId,
          };
        return structuredClone(state.conversation);
      },
    },
    message: {
      create: async ({ data }) => {
        if (faults.timeline) throw new Error("timeline unavailable");
        const message = { id: `m${state.timeline.length + 1}`, ...data };
        state.timeline.push(message);
        return message;
      },
    },
    user: {
      findUnique: async ({ where }) => ({
        ...agent(where.id),
        active: true,
        role: "AGENT",
        sites: [{ siteId: "s1" }],
      }),
    },
  };
  const prisma = {
    $transaction(callback) {
      const work = queue.then(async () => {
        const snapshot = structuredClone({
          conversation: state.conversation,
          timeline: state.timeline,
        });
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
  const service = loadConversationService({
    "./tenants": tenants,
    "../../lib/auth": auth,
    "../../lib/db": { prisma },
    "../../lib/realtime/public": {},
    "../../lib/widget": {},
    "../presence": {},
    "../serialize": serializer,
    "../transactions": locks,
    "./broadcast": {
      broadcastConversation: async () => {
        if (faults.broadcast) throw new Error("transport unavailable");
        return serializer.serializeConversation(state.conversation, {
          visitorOnline: false,
        });
      },
      broadcastMessage: async () => {
        if (faults.broadcast) throw new Error("transport unavailable");
      },
    },
    "./messages": {},
    "./notifications": {
      notifyConversationAssigned: async () => {
        state.assigned += 1;
      },
      notifyConversationClosed: async () => {
        state.closed += 1;
      },
    },
    "./visitors": {},
    "./follow-up-rules": {},
  });
  return { service, state, faults };
}

test("simultaneous claims assign one agent and reject the competing claim", async () => {
  const { service, state } = fixture();
  const results = await Promise.allSettled([
    service.claimConversation(agent("a1"), "c1"),
    service.claimConversation(agent("a2"), "c1"),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].reason.status, 409);
  assert.equal(state.conversation.assignedAgentId, "a1");
  assert.equal(state.timeline.length, 1);
  await service.claimConversation(agent("a1"), "c1");
  await nextTurn();
  assert.equal(state.timeline.length, 1);
  assert.equal(state.assigned, 1);
});

test("a failed timeline or conversation write rolls the entire action back", async () => {
  const { service, state, faults } = fixture();
  for (const failure of ["timeline", "update"]) {
    faults[failure] = true;
    await assert.rejects(
      service.claimConversation(agent(), "c1"),
      /unavailable/,
    );
    assert.equal(state.conversation.status, "PENDING");
    assert.equal(state.conversation.assignedAgentId, null);
    assert.equal(state.timeline.length, 0);
    assert.equal(state.assigned, 0);
    faults[failure] = false;
  }
});

test("transport failure and duplicate close requests preserve one committed close", async () => {
  const { service, state, faults } = fixture();
  faults.broadcast = true;
  const results = await Promise.all([
    service.closeConversation(agent(), "c1"),
    service.closeConversation(agent(), "c1"),
  ]);
  assert.ok(results.every((conversation) => conversation.status === "CLOSED"));
  assert.equal(state.timeline.length, 1);
  assert.equal(state.closed, 1);
});

test("stale reopen requests cannot take another agent's active conversation", async () => {
  const { service, state } = fixture();
  state.conversation.status = "CLOSED";
  await service.reopenConversation(agent("a1"), "c1");
  await assert.rejects(service.reopenConversation(agent("a2"), "c1"), {
    status: 409,
  });
  await service.reopenConversation(agent("a1"), "c1");
  assert.equal(state.conversation.assignedAgentId, "a1");
  assert.equal(state.timeline.length, 1);
});

test("transfers are idempotent, validate site access and leave closed conversations closed", async () => {
  const { service, state } = fixture();
  await assert.rejects(
    service.transferConversation(agent("a1", ["s2"]), "c1", "a2"),
    { status: 403 },
  );
  assert.equal(state.timeline.length, 0);
  await service.transferConversation(agent(), "c1", "a2");
  await service.transferConversation(agent(), "c1", "a2");
  assert.equal(state.timeline.length, 1);
  assert.equal(state.assigned, 1);
  await service.closeConversation(agent(), "c1");
  await assert.rejects(service.transferConversation(agent(), "c1", "a3"), {
    status: 400,
  });
  assert.equal(state.conversation.status, "CLOSED");
  assert.equal(state.timeline.length, 2);
});
