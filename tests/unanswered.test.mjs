import { test } from "node:test";
import assert from "node:assert/strict";
import {
  unansweredPolicy as p,
  unansweredService,
} from "./unanswered-fixtures.mjs";
const actor = {
  id: "manager",
  name: "管理员",
  tenantId: "tenant",
  role: "MERCHANT_ADMIN",
  siteIds: ["site"],
};
const valid = {
  enabled: true,
  ownerId: "owner",
  delayMinutes: 10,
  recipientMode: "ASSIGNED_OR_OWNER",
  expectedVersion: 0,
};
test("unanswered configuration bounds thresholds, recipients, versions and explicit scope", () => {
  for (const input of [
    { ...valid, delayMinutes: 0 },
    { ...valid, delayMinutes: 10081 },
    { ...valid, delayMinutes: 1.1 },
    { ...valid, ownerId: " " },
    { ...valid, recipientMode: "ALL" },
    { ...valid, expectedVersion: 2147483647 },
    { ...valid, tenantId: "foreign" },
    { ...valid, enabledAt: new Date() },
  ])
    assert.equal(p.unansweredRuleSchema.safeParse(input).success, false);
  assert.equal(
    p.unansweredRuleSchema.safeParse({ ...valid, enabled: false, ownerId: "" })
      .success,
    true,
  );
});
test("due detection requires a post-enable waiting round and includes the exact deadline", () => {
  const enabledAt = new Date("2026-10-20T01:00:00Z"),
    start = new Date("2026-10-20T01:00:01Z"),
    due = new Date(start.getTime() + 600000),
    rule = { enabled: true, enabledAt, delayMinutes: 10 };
  assert.equal(
    p.unansweredDue(start, "message", rule, new Date(due.getTime() - 1)),
    false,
  );
  assert.equal(p.unansweredDue(start, "message", rule, due), true);
  assert.equal(
    p.unansweredDue(new Date(enabledAt.getTime() - 1), "old", rule, due),
    false,
  );
  assert.equal(p.unansweredDue(start, null, rule, due), false);
  assert.equal(
    p.unansweredDue(start, "message", { ...rule, enabled: false }, due),
    false,
  );
  assert.equal(
    p.unansweredDue(start, "message", { ...rule, enabledAt: null }, due),
    false,
  );
});
test("agents cannot configure reminders and mutation rate limits run before persistence", async () => {
  await assert.rejects(
    unansweredService({}).getUnansweredRule(
      { ...actor, role: "AGENT" },
      "site",
    ),
    { status: 403 },
  );
  await assert.rejects(
    unansweredService({}).saveUnansweredRule(
      { ...actor, role: "AGENT" },
      "site",
      valid,
    ),
    { status: 403 },
  );
  await assert.rejects(
    unansweredService(
      {},
      { rateLimit: async () => ({ ok: false }) },
    ).saveUnansweredRule(actor, "site", valid),
    { status: 429 },
  );
});
test("site configuration queries include both merchant and site authorization", async () => {
  let where;
  const db = {
    $transaction: async (run) =>
      run({
        site: {
          findFirst: async (args) => {
            where = args.where;
            return null;
          },
        },
      }),
  };
  await assert.rejects(
    unansweredService(db).getUnansweredRule(actor, "foreign"),
    { status: 404 },
  );
  assert.equal(where.tenantId, actor.tenantId);
  assert.deepEqual(where.AND, [{ id: { in: actor.siteIds } }]);
});
test("stale reminder settings stop before writes", async () => {
  const db = {
    $transaction: async (run) =>
      run({
        $queryRaw: async () => [],
        site: { findFirst: async () => ({ id: "site", tenantId: "tenant" }) },
        unansweredRule: { findUnique: async () => ({ version: 2 }) },
      }),
  };
  await assert.rejects(
    unansweredService(db).saveUnansweredRule(actor, "site", valid),
    { status: 409 },
  );
});
test("workbench counters always constrain recipient, tenant and permitted sites", async () => {
  let where;
  const count = await unansweredService({
    unansweredReminder: {
      count: async (args) => {
        where = JSON.stringify(args.where);
        return 2;
      },
    },
  }).countUnansweredReminders({ ...actor, role: "AGENT" });
  assert.equal(count, 2);
  for (const part of [
    '"recipientId":"manager"',
    '"tenantId":"tenant"',
    '"siteId":{"in":["site"]}',
    '"resolvedAt":null',
  ])
    assert.ok(where.includes(part));
});
