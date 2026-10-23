import { test } from "node:test";
import assert from "node:assert/strict";
import { followUpRuleService, rulePolicy } from "./follow-up-rule-fixtures.mjs";

const admin = {
  id: "admin",
  name: "管理员",
  role: "MERCHANT_ADMIN",
  tenantId: "tenant",
  siteIds: ["site"],
};
const valid = {
  enabled: true,
  ownerId: "owner",
  delayMinutes: 60,
  expectedVersion: 0,
};
test("automation validates explicit scope, time limits, owners and CAS versions", () => {
  for (const input of [
    { ...valid, tenantId: "foreign" },
    { ...valid, delayMinutes: 0 },
    { ...valid, delayMinutes: 10081 },
    { ...valid, delayMinutes: 1.5 },
    { ...valid, delayMinutes: "60" },
    { ...valid, ownerId: " " },
    { ...valid, enabled: "true" },
    { ...valid, expectedVersion: -1 },
    { ...valid, expectedVersion: 2147483647 },
  ])
    assert.equal(rulePolicy.followUpRuleSchema.safeParse(input).success, false);
  assert.equal(
    rulePolicy.followUpRuleSchema.safeParse({
      ...valid,
      enabled: false,
      ownerId: "",
    }).success,
    true,
  );
  assert.equal(
    rulePolicy.followUpRuleSchema.safeParse({ ...valid, delayMinutes: 10080 })
      .success,
    true,
  );
});
test("ordinary agents and missing tenant identities cannot access rule configuration", async () => {
  const service = followUpRuleService({});
  for (const actor of [
    { ...admin, role: "AGENT" },
    { ...admin, tenantId: "" },
  ]) {
    await assert.rejects(service.getFollowUpRule(actor, "site"), {
      status: 403,
    });
    await assert.rejects(service.saveFollowUpRule(actor, "site", valid), {
      status: 403,
    });
  }
});
test("rule writes apply rate limits before opening a transaction", async () => {
  await assert.rejects(
    followUpRuleService(
      {},
      { rateLimit: async () => ({ ok: false }) },
    ).saveFollowUpRule(admin, "site", valid),
    { status: 429 },
  );
});
test("site lookups keep tenant and site permissions and do not reveal missing rules", async () => {
  let where;
  const service = followUpRuleService({
    $transaction: async (f) =>
      f({
        site: {
          findFirst: async (args) => {
            where = args.where;
            return null;
          },
        },
      }),
  });
  await assert.rejects(service.getFollowUpRule(admin, "foreign"), {
    status: 404,
  });
  assert.equal(where.tenantId, "tenant");
  assert.deepEqual(where.AND, [{ id: { in: ["site"] } }]);
});
test("a stale configuration fails before owner lookups or mutations", async () => {
  const tx = {
    site: { findFirst: async () => ({ id: "site", tenantId: "tenant" }) },
    $queryRaw: async () => [],
    followUpRule: { findUnique: async () => ({ version: 2 }) },
  };
  await assert.rejects(
    followUpRuleService({ $transaction: async (f) => f(tx) }).saveFollowUpRule(
      admin,
      "site",
      valid,
    ),
    { status: 409 },
  );
});
test("online, disabled and inactive site conversations never generate automatic tasks", async () => {
  const base = {
    id: "conv",
    source: "OFFLINE_FORM",
    siteId: "site",
    createdAt: new Date(),
    site: {
      tenantId: "tenant",
      active: true,
      tenant: { status: "ACTIVE", expiresAt: null },
      followUpRule: { enabled: true, ownerId: "owner" },
    },
  };
  for (const conversation of [
    null,
    { ...base, source: "WIDGET" },
    { ...base, site: { ...base.site, active: false } },
    { ...base, site: { ...base.site, followUpRule: null } },
    { ...base, site: { ...base.site, followUpRule: { enabled: false } } },
    {
      ...base,
      site: { ...base.site, followUpRule: { enabled: true, ownerId: null } },
    },
    { ...base, site: { ...base.site, tenant: { status: "SUSPENDED" } } },
    {
      ...base,
      site: {
        ...base.site,
        tenant: { status: "ACTIVE", expiresAt: new Date(0) },
      },
    },
  ]) {
    const tx = {
      $queryRaw: async () => [],
      conversation: { findUnique: async () => conversation },
    };
    assert.equal(
      await followUpRuleService({}).createOfflineFollowUp(tx, "conv"),
      false,
    );
  }
});
