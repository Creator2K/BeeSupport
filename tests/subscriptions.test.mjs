import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { loadModule, entitlements } from "./load-module.mjs";
const policy = loadModule("src/lib/subscriptions.ts", {
  zod: { z },
  "./entitlements": entitlements,
});

test("subscription amounts parse decimal yuan into exact cents and reject ambiguous prices", () => {
  for (const [value, cents] of [
    ["0", 0],
    ["0.01", 1],
    ["19.99", 1999],
    ["1000000.00", 100000000],
  ])
    assert.equal(policy.centsFromYuan(value), cents);
  for (const value of [
    "1.001",
    "-1",
    "1e3",
    "1,000",
    " 10 ",
    "01",
    "1000000.01",
    "NaN",
    "Infinity",
    "",
  ])
    assert.equal(policy.centsFromYuan(value), null);
});
test("renewals extend the unexpired term and use now for expired or perpetual services", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const future = new Date("2026-11-01T00:00:00Z");
  assert.equal(
    policy.renewalPeriod(future, 30, now).end.toISOString(),
    "2026-12-01T00:00:00.000Z",
  );
  for (const old of [null, new Date("2026-10-01T00:00:00Z"), now])
    assert.equal(
      policy.renewalPeriod(old, 30, now).end.toISOString(),
      "2026-11-19T00:00:00.000Z",
    );
});
test("order expiry is derived only for pending quotes and quota comparisons include unsent storage", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  assert.equal(
    policy.effectiveOrderStatus({ status: "PENDING", validUntil: now }, now),
    "EXPIRED",
  );
  assert.equal(
    policy.effectiveOrderStatus({ status: "CONFIRMED", validUntil: now }, now),
    "CONFIRMED",
  );
  const plan = {
    maxAgents: 2,
    maxSites: 1,
    monthlyConversations: 10,
    storageMB: 1,
  };
  const usage = {
    agents: 2,
    sites: 1,
    conversations: 10,
    storageBytes: 1048576,
  };
  assert.equal(policy.quotaConflict(plan, usage), null);
  for (const [key, value] of [
    ["agents", 3],
    ["sites", 2],
    ["conversations", 11],
    ["storageBytes", 1048577],
  ])
    assert.ok(policy.quotaConflict(plan, { ...usage, [key]: value }));
});
