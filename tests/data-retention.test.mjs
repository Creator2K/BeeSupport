import { test } from "node:test";
import assert from "node:assert/strict";
import * as zod from "zod";
import { loadModule } from "./load-module.mjs";

const now = new Date("2026-11-11T12:00:00Z");
const daysAgo = (days) => new Date(now.getTime() - days * 86_400_000);

/** An in-memory table that answers the two queries the age-based cleanup makes. */
function agedTable(rows) {
  const calls = { finds: 0, deletes: 0 };
  return {
    rows,
    calls,
    findMany: async ({ where, select, orderBy, take }) => {
      calls.finds += 1;
      assert.deepEqual(select, { id: true });
      assert.deepEqual(orderBy, { createdAt: "asc" });
      return rows
        .filter((row) => row.createdAt < where.createdAt.lt)
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, take)
        .map(({ id }) => ({ id }));
    },
    deleteMany: async ({ where }) => {
      calls.deletes += 1;
      const before = rows.length;
      for (const id of where.id.in) {
        const index = rows.findIndex((row) => row.id === id);
        if (index >= 0) rows.splice(index, 1);
      }
      return { count: before - rows.length };
    },
  };
}

const loadRetention = (prisma) =>
  loadModule("src/server/services/data-retention.ts", {
    "../../lib/db": { prisma },
  });

test("old block records and audit rows are removed in bounded batches, and only when enabled", async () => {
  const riskEvent = agedTable(
    Array.from({ length: 1300 }, (_, index) => ({
      id: `event-${index}`,
      // 1200 rows older than 180 days, 100 newer.
      createdAt: daysAgo(index < 1200 ? 181 + index : 10),
    })),
  );
  const auditLog = agedTable([
    { id: "old", createdAt: daysAgo(400) },
    { id: "recent", createdAt: daysAgo(364) },
  ]);
  const { cleanupRiskEvents, cleanupAuditLogs } = loadRetention({
    riskEvent,
    auditLog,
  });

  // 0 days means "keep everything": no query is made at all.
  assert.equal(await cleanupRiskEvents(0, { now }), 0);
  assert.equal(await cleanupAuditLogs(0, { now }), 0);
  assert.equal(riskEvent.calls.finds + auditLog.calls.finds, 0);

  // One pass stops at its row limit and leaves the rest for the next pass.
  assert.equal(await cleanupRiskEvents(180, { now, maxRows: 700 }), 700);
  assert.equal(riskEvent.rows.length, 600);
  assert.equal(await cleanupRiskEvents(180, { now }), 500);
  assert.equal(riskEvent.rows.length, 100);
  assert.ok(riskEvent.rows.every((row) => row.createdAt >= daysAgo(180)));
  // The oldest rows go first, 500 per statement.
  assert.equal(riskEvent.calls.deletes, 3);
  assert.equal(await cleanupRiskEvents(180, { now }), 0);

  assert.equal(await cleanupAuditLogs(365, { now }), 1);
  assert.deepEqual(
    auditLog.rows.map((row) => row.id),
    ["recent"],
  );

  // A stop request is honoured before the next batch.
  riskEvent.rows.push({ id: "late", createdAt: daysAgo(500) });
  assert.equal(
    await cleanupRiskEvents(180, { now, shouldStop: () => true }),
    0,
  );
  assert.equal(riskEvent.rows.length, 101);
});

test("only visitors that never did more than browse are removed, each under its row lock", async () => {
  const browseOnly = {
    email: "",
    name: null,
    blocked: false,
    profileNote: null,
    pendingImageId: null,
    profileTags: [],
    conversations: 0,
    lastSeenAt: daysAgo(120),
  };
  const visitors = [
    { id: "v01-idle", ...browseOnly },
    { id: "v02-recent", ...browseOnly, lastSeenAt: daysAgo(30) },
    { id: "v03-chatted", ...browseOnly, conversations: 1 },
    { id: "v04-email", ...browseOnly, email: "someone@example.test" },
    { id: "v05-named", ...browseOnly, name: "Someone" },
    { id: "v06-blocked", ...browseOnly, blocked: true },
    { id: "v07-noted", ...browseOnly, profileNote: "VIP" },
    { id: "v08-tagged", ...browseOnly, profileTags: ["lead"] },
    { id: "v09-image", ...browseOnly, pendingImageId: "attachment" },
    { id: "v10-returns", ...browseOnly },
    { id: "v11-idle", ...browseOnly },
  ];
  const matches = (row, where) =>
    row.lastSeenAt < where.lastSeenAt.lt &&
    row.email === where.email &&
    row.name === where.name &&
    row.blocked === where.blocked &&
    row.profileNote === where.profileNote &&
    row.pendingImageId === where.pendingImageId &&
    (where.profileTags.isEmpty ? row.profileTags.length === 0 : true) &&
    (where.conversations.none ? row.conversations === 0 : true) &&
    (typeof where.id === "string"
      ? row.id === where.id
      : where.id
        ? row.id > where.id.gt
        : true);
  const log = [];
  const tx = {
    $queryRaw: async (strings, id) => {
      assert.match(strings.join("?"), /FROM "Visitor" WHERE id = \? FOR UPDATE/);
      log.push(`lock ${id}`);
      // This visitor starts a conversation just before the cleanup gets the lock.
      if (id === "v10-returns")
        visitors.find((row) => row.id === id).conversations = 1;
    },
    visitor: {
      deleteMany: async ({ where }) => {
        const index = visitors.findIndex((row) => matches(row, where));
        log.push(`delete ${where.id} ${index >= 0 ? "removed" : "kept"}`);
        if (index < 0) return { count: 0 };
        visitors.splice(index, 1);
        return { count: 1 };
      },
    },
  };
  const { cleanupAnonymousVisitors } = loadRetention({
    visitor: {
      findMany: async ({ where, select, orderBy, take }) => {
        assert.deepEqual(select, { id: true });
        assert.deepEqual(orderBy, { id: "asc" });
        return visitors
          .filter((row) => matches(row, where))
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .slice(0, take)
          .map(({ id }) => ({ id }));
      },
    },
    $transaction: async (run) => run(tx),
  });

  assert.equal(await cleanupAnonymousVisitors(0, { now }), 0);
  assert.equal(visitors.length, 11);
  assert.deepEqual(log, []);

  assert.equal(await cleanupAnonymousVisitors(90, { now }), 2);
  assert.deepEqual(
    visitors.map((row) => row.id),
    [
      "v02-recent",
      "v03-chatted",
      "v04-email",
      "v05-named",
      "v06-blocked",
      "v07-noted",
      "v08-tagged",
      "v09-image",
      "v10-returns",
    ],
  );
  // Every delete is preceded by the lock on the same row, and the conditions
  // are checked again after it.
  assert.deepEqual(log, [
    "lock v01-idle",
    "delete v01-idle removed",
    "lock v10-returns",
    "delete v10-returns kept",
    "lock v11-idle",
    "delete v11-idle removed",
  ]);

  // The per-pass limit applies here too.
  visitors.push({ id: "v12-idle", ...browseOnly }, { id: "v13-idle", ...browseOnly });
  assert.equal(await cleanupAnonymousVisitors(90, { now, maxRows: 1 }), 1);
  assert.equal(visitors.some((row) => row.id === "v13-idle"), true);
});

test("retention settings are off unless set to a whole number of days", () => {
  const keys = [
    "AUTH_SECRET",
    "DATABASE_URL",
    "NODE_ENV",
    "RISK_EVENT_RETENTION_DAYS",
    "AUDIT_LOG_RETENTION_DAYS",
    "ANONYMOUS_VISITOR_RETENTION_DAYS",
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const read = () =>
    loadModule("src/lib/env.ts", { zod, "dotenv/config": {} }).env;
  try {
    process.env.AUTH_SECRET = "test-only-environment-secret-123456";
    process.env.DATABASE_URL = "postgresql://test:test@localhost:55433/test";
    process.env.NODE_ENV = "test";
    for (const key of keys.slice(3)) delete process.env[key];
    for (const key of keys.slice(3)) assert.equal(read()[key], 0);

    process.env.RISK_EVENT_RETENTION_DAYS = "180";
    // docker compose passes unset variables as empty strings.
    process.env.AUDIT_LOG_RETENTION_DAYS = "";
    assert.equal(read().RISK_EVENT_RETENTION_DAYS, 180);
    assert.equal(read().AUDIT_LOG_RETENTION_DAYS, 0);

    for (const invalid of ["-1", "1.5", "forever"]) {
      process.env.ANONYMOUS_VISITOR_RETENTION_DAYS = invalid;
      assert.throws(read, /ANONYMOUS_VISITOR_RETENTION_DAYS/);
    }
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
