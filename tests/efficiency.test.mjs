import { test } from "node:test";
import assert from "node:assert/strict";
import {
  efficiencyPolicy as p,
  efficiencyService,
} from "./efficiency-fixtures.mjs";
const now = new Date("2026-10-20T16:00:00Z"),
  input = { from: "2026-10-20", to: "2026-10-20", siteId: "", agentId: "" };
const actor = {
  id: "manager",
  role: "MERCHANT_ADMIN",
  tenantId: "tenant",
  siteIds: ["site"],
};
test("efficiency ranges use real Beijing dates, inclusive end dates and at most 90 days", () => {
  const { range } = p.efficiencyFilters(input, now);
  assert.equal(range.gte.toISOString(), "2026-10-19T16:00:00.000Z");
  assert.equal(range.lt.toISOString(), "2026-10-20T16:00:00.000Z");
  for (const bad of [
    { ...input, from: "2026-02-30" },
    { ...input, from: "2026-10-21", to: "2026-10-20" },
    { ...input, to: "2026-10-22" },
    { ...input, from: "2026-01-01" },
    { ...input, tenantId: "foreign" },
    { ...input, siteId: "x".repeat(129) },
  ])
    assert.throws(() => p.efficiencyFilters(bad, now));
  assert.equal(p.defaultEfficiencyFilters(now).to, "2026-10-21");
});
test("empty metric samples remain unavailable rather than displaying fabricated zero performance", () => {
  assert.equal(p.efficiencyDuration(null), "—");
  assert.equal(p.efficiencyDuration(-1), "—");
  assert.equal(p.efficiencyDuration(0), "0 秒");
  assert.equal(p.efficiencyDuration(900), "15.0 分钟");
  assert.equal(p.efficiencyDuration(172800), "2.0 天");
  assert.equal(p.efficiencyRate(0, 0), "—");
  assert.equal(p.efficiencyRate(0, 3), "0.0%");
  assert.equal(p.efficiencyRate(2, 3), "66.7%");
});
test("agents and missing merchant identities cannot query efficiency or its options", async () => {
  const service = efficiencyService({});
  for (const user of [
    { ...actor, role: "AGENT" },
    { ...actor, tenantId: "" },
  ]) {
    await assert.rejects(service.getEfficiency(user, input, now), {
      status: 403,
    });
    await assert.rejects(service.getEfficiencyOptions(user), { status: 403 });
  }
});
test("invalid dates fail before persistence and hidden sites and staff stop before aggregation", async () => {
  await assert.rejects(
    efficiencyService({}).getEfficiency(
      actor,
      { ...input, to: "2026-10-22" },
      now,
    ),
    { status: 400 },
  );
  let where;
  const db = {
    site: {
      findFirst: async (args) => {
        where = args.where;
        return null;
      },
    },
    user: { findFirst: async () => null },
  };
  await assert.rejects(
    efficiencyService(db).getEfficiency(
      actor,
      { ...input, siteId: "foreign" },
      now,
    ),
    { status: 404 },
  );
  assert.deepEqual(where.AND, [
    { tenantId: "tenant", id: { in: ["site"] } },
    { id: "foreign" },
  ]);
  await assert.rejects(
    efficiencyService(db).getEfficiency(
      actor,
      { ...input, agentId: "foreign" },
      now,
    ),
    { status: 404 },
  );
});
test("aggregate SQL binds tenant and site scope, includes all rows and fills missing calendar days", async () => {
  let query;
  const result = await efficiencyService({
    $queryRaw: async (sql) => {
      query = sql;
      return [
        {
          data: {
            summary: { total: 1 },
            sites: [],
            agents: [],
            siteGroups: 0,
            agentGroups: 0,
            trend: [],
          },
        },
      ];
    },
  }).getEfficiency(actor, input, now);
  assert.ok(query.values.includes("tenant"));
  assert.ok(query.values.includes("site"));
  assert.ok(query.sql.includes('s."tenantId" = ?'));
  assert.equal(result.trend.length, 1);
  assert.deepEqual(result.trend[0], {
    day: "2026-10-20",
    total: 0,
    waiting: 0,
    closed: 0,
  });
  assert.equal(result.asOf, now.toISOString());
  let emptyScope;
  await efficiencyService({
    $queryRaw: async (sql) => {
      emptyScope = sql;
      return [{ data: { summary: {}, sites: [], agents: [], trend: [] } }];
    },
  }).getEfficiency({ ...actor, siteIds: [] }, input, now);
  assert.ok(emptyScope.sql.includes("AND FALSE"));
});
