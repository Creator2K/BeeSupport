import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule, auth } from "./load-module.mjs";

const matching = loadModule("src/lib/risk-matching.ts");
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
  const risk = loadModule("src/server/services/risk.ts", {
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
    "../../lib/rate-limit": {
      clientIp: (headers) => headers.get("x-beesupport-client-ip"),
    },
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
