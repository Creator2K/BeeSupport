import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule, auth, nextTurn } from "./load-module.mjs";

const matching = loadModule("src/lib/risk-matching.ts");
const memoryLimiter = () =>
  loadModule("src/lib/rate-limit.ts", { "./redis": { getRedis: () => null } });
const ttlCache = loadModule("src/server/ttl-cache.ts");
/** Rule lists are cached process-wide, so every fixture starts with an empty cache. */
function loadRisk(dependencies) {
  const risk = loadModule("src/server/services/risk.ts", {
    "../ttl-cache": ttlCache,
    ...dependencies,
  });
  risk.clearRiskRuleCache();
  return risk;
}
test("IP rules validate prefixes and handle mapped IPv4 and IPv6 networks", () => {
  assert.equal(matching.matchesIp("::ffff:192.0.2.20", "192.0.2.0/24"), true);
  assert.equal(matching.matchesIp("192.0.3.20", "192.0.2.0/24"), false);
  assert.equal(matching.matchesIp("2001:db8:abcd::1", "2001:db8::/32"), true);
  assert.equal(matching.matchesIp("2001:db9::1", "2001:db8::/32"), false);
  for (const input of [
    "127.0.0.1/33",
    "2001:db8::/129",
    "192.0.2.1/-1",
    "1.2.3.4/24/1",
    "abc",
    "127.0.0.1/",
  ])
    assert.throws(() => matching.parseIpRule(input));
});
test("literal word matching normalizes case, fullwidth, spaces and invisible separators", () => {
  assert.equal(matching.matchesWord("这是违 禁\u200b词", "违禁词"), true);
  assert.equal(matching.matchesWord("ＡＢＣ", "abc"), true);
  assert.equal(matching.matchesWord("hello world", "a+b"), false);
  assert.equal(matching.matchesWord("anything", " \u200b "), false);
});
test("existing visitor sessions check current IP and blocked text never succeeds", async () => {
  const events = [];
  const rules = [
    { id: "r1", kind: "IP", value: "192.0.2.0/24" },
    { id: "r2", kind: "WORD", value: "违禁词" },
  ];
  const risk = loadRisk({
    "../../lib/auth": auth,
    "../../lib/db": {
      prisma: {
        site: { findUnique: async () => ({ tenantId: "tenant1" }) },
        riskRule: {
          findMany: async ({ where }) =>
            rules.filter((r) => r.kind === where.kind),
        },
        riskEvent: {
          create: async ({ data }) => {
            events.push(data);
          },
        },
      },
    },
    "../../lib/rate-limit": memoryLimiter(),
    "../../lib/risk-matching": matching,
    "../../lib/visitor-auth": {
      readVisitorToken: () => "valid",
      verifyVisitorToken: async () => ({ visitorId: "v1", siteId: "s1" }),
    },
  });
  await assert.rejects(
    risk.verifyVisitorRequest(
      new Headers({ "x-beesupport-client-ip": "192.0.2.22" }),
    ),
    { status: 403 },
  );
  assert.equal(
    (
      await risk.verifyVisitorRequest(
        new Headers({ "x-beesupport-client-ip": "198.51.100.1" }),
      )
    ).visitorId,
    "v1",
  );
  await assert.rejects(
    risk.assertVisitorContentAllowed({
      siteId: "s1",
      visitorId: "v1",
      ip: "198.51.100.1",
      text: "违\u200b禁词",
      context: "message",
    }),
    { status: 403 },
  );
  assert.equal(events.length, 2);
  assert.equal(events[1].context, "message");
  assert.equal(Object.hasOwn(events[1], "text"), false);
});

test("repeated blocks are refused every time but recorded once per ten minutes", async () => {
  const events = [];
  const rules = [
    { id: "r1", kind: "IP", value: "192.0.2.0/24" },
    { id: "r2", kind: "IP", value: "2001:db8::/32" },
  ];
  const risk = loadRisk({
    "../../lib/auth": auth,
    "../../lib/db": {
      prisma: {
        site: { findUnique: async () => ({ tenantId: "tenant1" }) },
        riskRule: { findMany: async () => rules },
        riskEvent: {
          create: async ({ data }) => {
            events.push(data);
          },
        },
      },
    },
    "../../lib/rate-limit": memoryLimiter(),
    "../../lib/risk-matching": matching,
    "../../lib/visitor-auth": {
      readVisitorToken: () => null,
      verifyVisitorToken: async () => null,
    },
  });
  const blocked = (input) =>
    assert.rejects(risk.assertIpAllowed({ siteId: "s1", ...input }), {
      status: 403,
    });

  for (let index = 0; index < 5; index += 1)
    await blocked({
      ip: "192.0.2.10",
      visitorId: "v1",
      context: "authenticated-request",
    });
  assert.equal(events.length, 1);

  // Another context, visitor, address or site is a separate record.
  await blocked({ ip: "192.0.2.10", visitorId: "v1", context: "visit" });
  await blocked({ ip: "192.0.2.10", visitorId: "v2", context: "visit" });
  await blocked({ ip: "192.0.2.11", visitorId: "v1", context: "visit" });
  await blocked({
    siteId: "s2",
    ip: "192.0.2.10",
    visitorId: "v1",
    context: "visit",
  });
  assert.equal(events.length, 5);
  assert.equal(events[4].siteId, "s2");

  // Addresses of one IPv6 /64 are one source; the record keeps the exact address.
  await blocked({ ip: "2001:db8:1:2::1", context: "visit" });
  await blocked({ ip: "2001:db8:1:2::2", context: "visit" });
  assert.equal(events.length, 6);
  assert.equal(events[5].ip, "2001:db8:1:2::1");
  assert.equal(events[5].ruleId, "r2");

  // Rotating sources cannot push one site past 300 records per rule kind.
  for (let index = 0; index < 400; index += 1)
    await blocked({ ip: `2001:db8:2:${index.toString(16)}::1`, context: "visit" });
  assert.equal(events.filter((event) => event.siteId === "s1").length, 300);
  // Another site keeps recording.
  await blocked({ siteId: "s2", ip: "192.0.2.99", context: "visit" });
  assert.equal(events.filter((event) => event.siteId === "s2").length, 2);
});

function budgetFixture() {
  const state = { tokenChecks: 0 };
  const risk = loadRisk({
    "../../lib/auth": auth,
    "../../lib/db": {
      prisma: {
        site: { findUnique: async () => ({ tenantId: "tenant1" }) },
        riskRule: { findMany: async () => [] },
        riskEvent: { create: async () => {} },
      },
    },
    "../../lib/rate-limit": memoryLimiter(),
    "../../lib/risk-matching": matching,
    "../../lib/visitor-auth": {
      readVisitorToken: (headers) => headers.get("authorization"),
      // The token doubles as the visitor id; "expired" no longer verifies.
      verifyVisitorToken: async (token) => {
        state.tokenChecks += 1;
        return token === "expired" ? null : { visitorId: token, siteId: "s1" };
      },
    },
  });
  const request = (token, ip) =>
    risk.verifyVisitorRequest(
      new Headers({ authorization: token, "x-beesupport-client-ip": ip }),
    );
  return { state, request };
}

test("one visitor's requests share a five-minute budget across addresses", async () => {
  const { request } = budgetFixture();
  for (let index = 0; index < 1200; index += 1)
    assert.equal((await request("v1", "198.51.100.1")).visitorId, "v1");
  await assert.rejects(request("v1", "198.51.100.1"), { status: 429 });
  await assert.rejects(request("v1", "198.51.100.2"), { status: 429 });
  // Other visitors behind the same address are not affected.
  assert.equal((await request("v2", "198.51.100.1")).visitorId, "v2");
});

test("a source address has a request budget that is checked before the token", async () => {
  const { state, request } = budgetFixture();
  // 100 visitors on 500 addresses of one IPv6 /64, each visitor within its own budget.
  for (let index = 0; index < 12000; index += 1)
    await request(
      `v${index % 100}`,
      `2001:db8:1:2::${((index % 500) + 1).toString(16)}`,
    );
  assert.equal(state.tokenChecks, 12000);

  await assert.rejects(request("v-new", "2001:db8:1:2:ffff::1"), {
    status: 429,
  });
  assert.equal(state.tokenChecks, 12000);

  // A neighbouring /64 is a different source. A token that no longer verifies
  // is reported as "no visitor" (the routes answer 401), not as an error.
  assert.equal(await request("expired", "2001:db8:1:3::1"), null);
  assert.equal(
    (await request("v-new", "2001:db8:1:3::1")).visitorId,
    "v-new",
  );
});

const ipRule = (id, value, expiresAt = null) => ({
  id,
  kind: "IP",
  value,
  expiresAt,
});

function cacheFixture(rules) {
  const queries = { site: 0, rules: 0 };
  // `wait` holds back the answer of a rule query that has already read `rules`.
  const source = { rules, wait: null };
  const risk = loadRisk({
    "../../lib/auth": auth,
    "../../lib/db": {
      prisma: {
        site: {
          findUnique: async () => {
            queries.site += 1;
            return { tenantId: "tenant1" };
          },
        },
        riskRule: {
          findMany: async ({ where }) => {
            queries.rules += 1;
            const found = source.rules.filter(
              (rule) => rule.kind === where.kind,
            );
            await source.wait;
            return found;
          },
        },
        riskEvent: { create: async () => {} },
      },
    },
    "../../lib/rate-limit": memoryLimiter(),
    "../../lib/risk-matching": matching,
    "../../lib/visitor-auth": {
      readVisitorToken: () => null,
      verifyVisitorToken: async () => null,
    },
  });
  const check = (ip, options) =>
    risk.assertIpAllowed({ siteId: "s1", ip, context: "visit" }, true, options);
  return { risk, queries, source, check };
}

test("rule lists are read once per site and kind while they are cached", async () => {
  const { risk, queries, source, check } = cacheFixture([
    ipRule("r1", "192.0.2.0/24"),
  ]);

  for (let index = 0; index < 50; index += 1) await check("198.51.100.1");
  await assert.rejects(check("192.0.2.1"), { status: 403 });
  assert.deepEqual(queries, { site: 1, rules: 1 });

  // Another site and another kind of rule have their own lists.
  await risk.assertIpAllowed({ siteId: "s2", ip: "198.51.100.1" });
  await risk.assertVisitorContentAllowed({
    siteId: "s1",
    ip: "198.51.100.1",
    text: "hello",
  });
  assert.deepEqual(queries, { site: 3, rules: 3 });

  // A rule added by another instance is not seen by cached reads. A read that
  // skips the cache (the socket handshake) sees it and refreshes the list.
  source.rules = [...source.rules, ipRule("r2", "198.51.100.0/24")];
  await check("198.51.100.1");
  await assert.rejects(check("198.51.100.1", { fresh: true }), { status: 403 });
  await assert.rejects(check("198.51.100.1"), { status: 403 });
  assert.deepEqual(queries, { site: 4, rules: 4 });
});

test("a rule change in this process applies to the next request", async () => {
  const { risk, queries, source, check } = cacheFixture([]);
  await check("192.0.2.1");

  source.rules = [ipRule("r1", "192.0.2.0/24")];
  risk.clearRiskRuleCache();
  await assert.rejects(check("192.0.2.1"), { status: 403 });
  assert.equal(queries.rules, 2);

  // A list that was read before a change but arrives after it is used by the
  // request that asked for it and is not kept.
  source.rules = [];
  risk.clearRiskRuleCache();
  let release;
  source.wait = new Promise((resolve) => {
    release = resolve;
  });
  const early = check("192.0.2.1");
  await nextTurn();
  assert.equal(queries.rules, 3);
  source.rules = [ipRule("r1", "192.0.2.0/24")];
  risk.clearRiskRuleCache();
  source.wait = null;
  release();
  await early;
  await assert.rejects(check("192.0.2.1"), { status: 403 });
  assert.equal(queries.rules, 4);
});

test("a cached rule stops applying when it expires", async () => {
  const rule = ipRule("r1", "192.0.2.0/24", new Date(Date.now() + 3_600_000));
  const { queries, check } = cacheFixture([rule]);
  await assert.rejects(check("192.0.2.1"), { status: 403 });

  // The same cached list after the rule's expiry time has passed.
  rule.expiresAt = new Date(Date.now() - 1);
  await check("192.0.2.1");
  assert.equal(queries.rules, 1);
});

test("RISK_RULE_CACHE_TTL_MS=0 reads the rules on every request", async () => {
  // The cache is created once per process, so drop it around this test.
  process.env.RISK_RULE_CACHE_TTL_MS = "0";
  delete globalThis.__beeRiskRules;
  try {
    const { queries, source, check } = cacheFixture([]);
    await check("192.0.2.1");
    source.rules = [ipRule("r1", "192.0.2.0/24")];
    await assert.rejects(check("192.0.2.1"), { status: 403 });
    assert.deepEqual(queries, { site: 2, rules: 2 });
  } finally {
    delete process.env.RISK_RULE_CACHE_TTL_MS;
    delete globalThis.__beeRiskRules;
  }

  // An empty or invalid value keeps the default.
  for (const value of ["", "soon", "-1"]) {
    process.env.RISK_RULE_CACHE_TTL_MS = value;
    delete globalThis.__beeRiskRules;
    try {
      const { queries, check } = cacheFixture([]);
      await check("192.0.2.1");
      await check("192.0.2.1");
      assert.equal(queries.rules, 1, `value ${JSON.stringify(value)}`);
    } finally {
      delete process.env.RISK_RULE_CACHE_TTL_MS;
      delete globalThis.__beeRiskRules;
    }
  }
});
