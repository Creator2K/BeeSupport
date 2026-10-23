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
function loginFixture(userOverride = {}) {
  const limiter = loadModule("src/lib/rate-limit.ts", {
    "./redis": { getRedis: () => null },
  });
  let checks = 0;
  let sessions = 0;
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
      verifyPassword: async (p) => {
        checks++;
        return p === "correct";
      },
    },
    "@/lib/audit": { recordAudit: async () => {} },
    "@/lib/db": {
      prisma: {
        user: {
          findUnique: async ({ where }) => ({
            id: where.email,
            email: where.email,
            name: "测试",
            role: "AGENT",
            active: true,
            passwordHash: "unused",
            tokenVersion: 0,
            tenantId: "t",
            tenant: { status: "ACTIVE" },
            ...userOverride,
          }),
          update: async () => {},
        },
      },
    },
    "@/lib/rate-limit": limiter,
    "@/lib/validation": { emailSchema: z.string().email() },
  });
  return {
    login: (email, password = "correct") =>
      route.POST(
        new Request("http://test.local/api/auth/login", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-beesupport-client-ip": "192.168.1.2",
          },
          body: JSON.stringify({ email, password }),
        }),
      ),
    checks: () => checks,
    sessions: () => sessions,
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
