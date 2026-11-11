import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { loadModule, entitlements } from "./load-module.mjs";
const drafts = loadModule("src/lib/chat-drafts.ts"),
  operations = loadModule("src/lib/operations.ts");
function store() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}
test("local drafts survive reload per account/conversation, expire and tolerate corrupt or unavailable stores", () => {
  const storage = store(),
    now = Date.now();
  drafts.storeDraft(storage, "a", "c1", "草稿一", now);
  drafts.storeDraft(storage, "a", "c2", "草稿二", now);
  drafts.storeDraft(storage, "b", "c1", "另一个账号", now);
  assert.deepEqual(drafts.loadDrafts(storage, "a", now), {
    c1: "草稿一",
    c2: "草稿二",
  });
  drafts.storeDraft(storage, "a", "c1", "", now);
  assert.deepEqual(drafts.loadDrafts(storage, "a", now), { c2: "草稿二" });
  assert.deepEqual(drafts.loadDrafts(storage, "b", now), { c1: "另一个账号" });
  assert.deepEqual(drafts.loadDrafts(storage, "a", now + 7 * 86400000), {});
  storage.setItem(drafts.draftPrefix("a") + "bad", "{broken");
  assert.equal(Object.keys(drafts.loadDrafts(storage, "a", now)).length, 1);
  for (let i = 0; i < 60; i++)
    drafts.storeDraft(storage, "a", `c${i}`, "x".repeat(5100), now + i);
  const rows = drafts.loadDrafts(storage, "a", now + 60);
  assert.equal(Object.keys(rows).length, 50);
  assert.ok(Object.values(rows).every((v) => v.length === 5000));
  const blocked = {
    get length() {
      throw Error("denied");
    },
    setItem() {
      throw Error("quota");
    },
  };
  assert.deepEqual(drafts.loadDrafts(blocked, "a"), {});
  assert.doesNotThrow(() => drafts.storeDraft(blocked, "a", "c1", "text"));
});
test("feature documents preserve legacy access, fail closed for malformed grants and cannot grant unknown capabilities", () => {
  assert.deepEqual(entitlements.readFeatures({}), entitlements.LEGACY_FEATURES);
  for (const bad of [
    { ai: true },
    { ...entitlements.LEGACY_FEATURES, export: true },
    "true",
  ])
    assert.deepEqual(
      entitlements.readFeatures(bad),
      entitlements.BASIC_FEATURES,
    );
  assert.equal(
    entitlements.featuresSchema.safeParse(entitlements.BASIC_FEATURES).success,
    true,
  );
});
test("operations windows use Beijing calendar days across UTC midnight and clamp unsupported periods", () => {
  const now = new Date("2026-10-20T16:00:00Z"),
    window = operations.operationWindow(7, now);
  assert.equal(window.labels[0], "2026-10-15");
  assert.equal(window.labels.at(-1), "2026-10-21");
  assert.equal(window.start.toISOString(), "2026-10-14T16:00:00.000Z");
  assert.equal(operations.operationWindow(900, now).days, 30);
});
/** Pass null instead of overrides for a deployment where no account matches. */
function loginFixture(userOverride = {}) {
  const limiter = loadModule("src/lib/rate-limit.ts", {
    "./redis": { getRedis: () => null },
  });
  let checks = 0;
  let sessions = 0;
  let placeholders = 0;
  const comparedHashes = [];
  const route = loadModule("src/app/api/auth/login/route.ts", {
    "next/server": {
      NextResponse: {
        json: (body, init) => new Response(JSON.stringify(body), init),
      },
    },
    zod: { z },
    "@/lib/api": {
      readJson: (r) => r.json(),
      toErrorResponse: (error) => {
        throw error;
      },
    },
    "@/server/services/onboarding": { loginDestination: async () => "/agent" },
    "@/lib/auth": {
      createSession: async () => {
        sessions++;
      },
      hashPassword: async () => {
        placeholders++;
        return "placeholder-hash";
      },
      verifyPassword: async (p, hash) => {
        checks++;
        comparedHashes.push(hash);
        return p === "correct";
      },
    },
    "@/lib/audit": { recordAudit: async () => {} },
    "@/lib/db": {
      prisma: {
        user: {
          findUnique: async ({ where }) =>
            userOverride && {
              id: where.email,
              email: where.email,
              name: "测试",
              role: "AGENT",
              active: true,
              passwordHash: "stored-hash",
              tokenVersion: 0,
              tenantId: "t",
              tenant: { status: "ACTIVE" },
              ...userOverride,
            },
          update: async () => {},
        },
      },
    },
    "@/lib/rate-limit": limiter,
    "@/lib/validation": { emailSchema: z.string().email() },
  });
  return {
    login: (email, password = "correct", ip = "192.168.1.2") =>
      route.POST(
        new Request("http://test.local/api/auth/login", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-beesupport-client-ip": ip,
          },
          body: JSON.stringify({ email, password }),
        }),
      ),
    checks: () => checks,
    sessions: () => sessions,
    placeholders: () => placeholders,
    comparedHashes: () => comparedHashes,
  };
}
test("new accounts requiring verification cannot establish a session before verifying their email", async () => {
  const pending = loginFixture({
    emailVerificationRequired: true,
    emailVerifiedAt: null,
  });
  const blocked = await pending.login("pending@example.com");
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).verificationRequired, true);
  assert.equal(pending.sessions(), 0);
  const verified = loginFixture({
    emailVerificationRequired: true,
    emailVerifiedAt: new Date(),
  });
  assert.equal((await verified.login("verified@example.com")).status, 200);
  assert.equal(verified.sessions(), 1);
});
test("more than twenty successful office logins are allowed while repeated password failures are still blocked", async () => {
  const f = loginFixture();
  for (let i = 0; i < 25; i++)
    assert.equal((await f.login(`u${i}@example.com`)).status, 200);
  for (let i = 0; i < 10; i++)
    assert.equal((await f.login("bad@example.com", "wrong")).status, 401);
  const before = f.checks(),
    blocked = await f.login("bad@example.com");
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  assert.equal(f.checks(), before);
  assert.equal((await f.login("other@example.com")).status, 200);
});
test("successful authentication clears that account's failed-attempt count without resetting IP failure protection", async () => {
  const f = loginFixture();
  for (let i = 0; i < 9; i++) await f.login("a@example.com", "wrong");
  assert.equal((await f.login("a@example.com")).status, 200);
  for (let i = 0; i < 9; i++)
    assert.equal((await f.login("a@example.com", "wrong")).status, 401);
  assert.equal((await f.login("a@example.com")).status, 200);
  for (let i = 0; i < 32; i++) await f.login(`bad${i}@example.com`, "wrong");
  assert.equal((await f.login("new@example.com")).status, 429);
});
test("a failed login does not reveal whether the account exists or is disabled", async () => {
  const generic = "邮箱或密码不正确";

  const unknown = loginFixture(null);
  const missing = await unknown.login("ghost@example.com");
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).error, generic);
  await unknown.login("ghost2@example.com", "wrong");
  // An unknown account costs the same comparison as a real one, and the
  // stand-in hash is prepared once.
  assert.deepEqual(unknown.comparedHashes(), [
    "placeholder-hash",
    "placeholder-hash",
  ]);
  assert.equal(unknown.placeholders(), 1);
  assert.equal(unknown.sessions(), 0);

  const disabled = loginFixture({ active: false });
  const wrong = await disabled.login("off@example.com", "wrong");
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).error, generic);
  assert.deepEqual(disabled.comparedHashes(), ["stored-hash"]);
  // Only someone who knows the password is told the account is disabled.
  const right = await disabled.login("off@example.com");
  assert.equal(right.status, 401);
  assert.equal((await right.json()).error, "该账号已被禁用");
  assert.equal(disabled.sessions(), 0);
  assert.equal(disabled.placeholders(), 0);

  // Unknown and disabled accounts lock the same way as real ones.
  for (const fixture of [unknown, disabled]) {
    for (let i = 0; i < 10; i++) await fixture.login("probe@example.com", "wrong");
    assert.equal((await fixture.login("probe@example.com")).status, 429);
  }
});
test("wrong passwords from one address lock that address only, while many addresses together still lock the account", async () => {
  const f = loginFixture();
  const owner = "203.0.113.9";
  for (let i = 0; i < 10; i++)
    assert.equal(
      (await f.login("boss@example.com", "wrong", "198.51.100.1")).status,
      401,
    );
  assert.equal(
    (await f.login("boss@example.com", "correct", "198.51.100.1")).status,
    429,
  );
  assert.equal((await f.login("boss@example.com", "correct", owner)).status, 200);

  // Nine more addresses bring the account to 100 failures in the window.
  for (let address = 2; address <= 10; address++)
    for (let i = 0; i < 10; i++)
      assert.equal(
        (await f.login("boss@example.com", "wrong", `198.51.100.${address}`))
          .status,
        401,
      );
  assert.equal((await f.login("boss@example.com", "correct", owner)).status, 429);
  assert.equal((await f.login("other@example.com", "correct", owner)).status, 200);
});
test("IPv6 addresses in one /64 count as a single login source", async () => {
  const { rateLimitSource } = loadModule("src/lib/rate-limit.ts", {
    "./redis": { getRedis: () => null },
  });
  assert.equal(rateLimitSource("203.0.113.7"), "203.0.113.7");
  for (const address of [
    "2001:db8:12:34:aaaa:bbbb:cccc:dddd",
    "2001:0DB8:0012:0034::1",
    "2001:db8:12:34::",
    "2001:db8:12:34::10.0.0.1",
    "2001:db8:12:34:1:2:3:4%eth0",
  ])
    assert.equal(rateLimitSource(address), "2001:db8:12:34::/64");
  assert.equal(rateLimitSource("2001:db8:12:35::1"), "2001:db8:12:35::/64");
  assert.equal(rateLimitSource("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(rateLimitSource("fe80::1"), "fe80:0:0:0::/64");
  // Loopback, IPv4-mapped and malformed values are counted as they are.
  for (const value of [
    "::1",
    "::",
    "::ffff:102:304",
    "::ffff:1.2.3.4",
    "0.0.0.0",
    "2001:db8:::1",
    "not-an-ip",
    "",
  ])
    assert.equal(rateLimitSource(value), value);

  const f = loginFixture();
  for (let i = 1; i <= 10; i++)
    assert.equal(
      (await f.login("v6@example.com", "wrong", `2001:db8:12:34::${i}`)).status,
      401,
    );
  assert.equal(
    (await f.login("v6@example.com", "correct", "2001:db8:12:34:ffff::1"))
      .status,
    429,
  );
  assert.equal(
    (await f.login("v6@example.com", "correct", "2001:db8:12:35::1")).status,
    200,
  );
});
