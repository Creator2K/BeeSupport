import { test } from "node:test";
import assert from "node:assert/strict";
import { followUpPolicy as p, followUpService } from "./follow-up-fixtures.mjs";
const now = new Date("2026-10-20T03:00:00Z");
const agent = {
  id: "agent",
  role: "AGENT",
  tenantId: "own",
  siteIds: ["site"],
  name: "客服",
};
const save = {
  action: "save",
  expectedVersion: 0,
  ownerId: "agent",
  note: "核对订单",
  dueAt: "2026-10-21T03:00:00Z",
};
function tx(current) {
  return {
    conversation: {
      findFirst: async () => ({
        id: "conversation",
        siteId: "site",
        site: { tenantId: "own" },
      }),
    },
    $queryRaw: async () => [],
    followUp: {
      findUnique: async () => current,
      create: async () => {
        throw Error("Unexpected write");
      },
      update: async () => {
        throw Error("Unexpected write");
      },
    },
    auditLog: {
      create: async () => {
        throw Error("Unexpected audit");
      },
    },
  };
}
test("follow-up inputs reject forged ownership scope, invalid states and noninteger versions", () => {
  assert.equal(
    p.followUpActionSchema.parse({ ...save, note: " 核对 " }).note,
    "核对",
  );
  for (const input of [
    { ...save, tenantId: "foreign" },
    { ...save, status: "DONE" },
    { ...save, note: " " },
    { ...save, note: "x".repeat(1001) },
    { ...save, expectedVersion: -1 },
    { ...save, expectedVersion: 1.5 },
    { action: "delete", expectedVersion: 1 },
    { ...save, dueAt: "tomorrow" },
  ])
    assert.equal(p.followUpActionSchema.safeParse(input).success, false);
});
test("follow-up times use Beijing calendar boundaries and validate real dates and future scheduling", () => {
  assert.equal(
    p.parseFollowUpLocal("2026-10-21T00:00"),
    "2026-10-20T16:00:00.000Z",
  );
  assert.equal(p.followUpLocalTime("2026-10-20T16:00:00Z"), "2026-10-21T00:00");
  assert.equal(
    p.followUpToday(now).gte.toISOString(),
    "2026-10-19T16:00:00.000Z",
  );
  assert.equal(
    p.followUpToday(now).lt.toISOString(),
    "2026-10-20T16:00:00.000Z",
  );
  for (const value of [
    "2026-02-29T10:00",
    "2026-10-21T24:00",
    "2026-10-21T10:60",
    "",
    "2026-10-21T12:00Z",
  ])
    assert.throws(() => p.parseFollowUpLocal(value));
  assert.throws(() => p.validateFollowUpDue(now.toISOString(), now));
  assert.throws(() =>
    p.validateFollowUpDue(
      new Date(now.getTime() + 366 * 86400000).toISOString(),
      now,
    ),
  );
  assert.doesNotThrow(() => p.validateFollowUpDue(save.dueAt, now));
});
test("invalid actors, self-assignment violations and invalid deadlines fail before persistence", async () => {
  const service = followUpService(
    new Proxy(
      {},
      {
        get() {
          throw Error("Unexpected persistence access");
        },
      },
    ),
  );
  await assert.rejects(
    service.changeFollowUp(
      { role: "unknown", tenantId: "own" },
      "conversation",
      save,
      now,
    ),
    { status: 403 },
  );
  await assert.rejects(
    service.changeFollowUp(
      agent,
      "conversation",
      { ...save, ownerId: "other" },
      now,
    ),
    { status: 403 },
  );
  await assert.rejects(
    service.changeFollowUp(
      agent,
      "conversation",
      { ...save, dueAt: now.toISOString() },
      now,
    ),
    { status: 400 },
  );
});
test("conversation access, existing task ownership and stale versions prevent writes", async () => {
  const hidden = tx(null);
  hidden.conversation.findFirst = async () => null;
  await assert.rejects(
    followUpService({ $transaction: async (f) => f(hidden) }).changeFollowUp(
      agent,
      "conversation",
      save,
      now,
    ),
    { status: 404 },
  );
  for (const [current, status] of [
    [{ ownerId: "other", tenantId: "own", version: 1 }, 403],
    [{ ownerId: "agent", tenantId: "own", version: 2 }, 409],
    [{ ownerId: "agent", tenantId: "foreign", version: 1 }, 403],
  ]) {
    await assert.rejects(
      followUpService({
        $transaction: async (f) => f(tx(current)),
      }).changeFollowUp(
        agent,
        "conversation",
        { action: "complete", expectedVersion: 1 },
        now,
      ),
      { status },
    );
  }
});
test("inactive, foreign or unauthorized owners are rejected without creating tasks", async () => {
  const transaction = tx(null);
  transaction.user = { findFirst: async () => null };
  const service = followUpService({
    $transaction: async (f) => f(transaction),
  });
  await assert.rejects(
    service.changeFollowUp(
      { ...agent, role: "MERCHANT_ADMIN" },
      "conversation",
      { ...save, ownerId: "invalid-owner" },
      now,
    ),
    { status: 400 },
  );
});
test("processed tasks cannot be completed or cancelled again", async () => {
  for (const status of ["DONE", "CANCELLED"]) {
    const transaction = tx({
      ownerId: agent.id,
      tenantId: "own",
      status,
      version: 2,
    });
    await assert.rejects(
      followUpService({
        $transaction: async (f) => f(transaction),
      }).changeFollowUp(
        agent,
        "conversation",
        { action: "complete", expectedVersion: 2 },
        now,
      ),
      { status: 409 },
    );
  }
});
test("due counts include only the current owner's authorized merchant and sites", async () => {
  let where;
  const service = followUpService({
    followUp: {
      count: async (args) => {
        where = JSON.stringify(args.where);
        return 3;
      },
    },
  });
  assert.equal(await service.countDueFollowUps(agent, now), 3);
  for (const value of [
    '"ownerId":"agent"',
    '"tenantId":"own"',
    '"in":["site"]',
    '"status":"OPEN"',
  ])
    assert.ok(where.includes(value));
});
test("follow-up mutations apply rate limits before opening a transaction", async () => {
  const service = followUpService(
    new Proxy(
      {},
      {
        get() {
          throw Error("Unexpected persistence access");
        },
      },
    ),
    { rateLimit: async () => ({ ok: false }) },
  );
  await assert.rejects(
    service.changeFollowUp(agent, "conversation", save, now),
    { status: 429 },
  );
});
