import { test } from "node:test";
import assert from "node:assert/strict";
import * as jose from "jose";
import { loadModule, auth, tenants } from "./load-module.mjs";

const env = {
  AUTH_SECRET: "regression-test-secret-only-123456",
  APP_URL: "http://test.local",
};
const hours = loadModule("src/lib/work-hours.ts");
const widget = loadModule("src/lib/widget.ts", {
  "../server/services/tenants": tenants,
  "./auth": auth,
  "./db": { prisma: {} },
  "./work-hours": hours,
});
const origin = loadModule("src/lib/widget-origin.ts", {
  jose,
  "./auth": auth,
  "./env": { env },
  "./widget": widget,
});

test("a signed embedding origin survives same-origin iframe fetches", async () => {
  const site = {
    id: "s1",
    publicKey: "key1",
    allowedOrigins: ["shop.example.com"],
  };
  const token = await origin.createEmbedToken(
    site,
    "https://shop.example.com/product",
  );
  await origin.assertWidgetOriginAllowed(
    site,
    new Headers({
      origin: "https://support.example.com",
      "x-beesupport-embed": token,
    }),
  );
  await assert.rejects(
    origin.createEmbedToken(site, "https://evil.example.com"),
    { status: 403 },
  );
  await assert.rejects(
    origin.assertWidgetOriginAllowed(
      site,
      new Headers({
        origin: "https://support.example.com",
        "x-host": "https://shop.example.com",
      }),
    ),
    { status: 403 },
  );
});

test("embed tokens cannot be tampered with, reused across sites or survive key rotation", async () => {
  const site = {
    id: "s1",
    publicKey: "key1",
    allowedOrigins: ["*.example.com"],
  };
  const token = await origin.createEmbedToken(site, "https://shop.example.com");
  for (const [changedSite, changedToken] of [
    [site, token.slice(0, -4) + "AAAA"],
    [{ ...site, id: "s2" }, token],
    [{ ...site, publicKey: "rotated" }, token],
  ]) {
    await assert.rejects(
      origin.assertWidgetOriginAllowed(
        changedSite,
        new Headers({ "x-beesupport-embed": changedToken }),
      ),
      { status: 403 },
    );
  }
});

test("administrator preview tokens are site-bound, expiring and do not change ordinary origin checks", async () => {
  const site = {
    id: "s1",
    publicKey: "key1",
    allowedOrigins: ["shop.example.com"],
  };
  const preview = await origin.createPreviewToken(site);
  const payload = jose.decodeJwt(preview);
  assert.equal(payload.exp - payload.iat, 3600);
  const token = await origin.createEmbedToken(
    site,
    "http://support.local/preview",
    preview,
  );
  await origin.assertWidgetOriginAllowed(
    site,
    new Headers({ "x-beesupport-embed": token }),
  );
  await assert.rejects(
    origin.createEmbedToken(site, "http://support.local/preview"),
    { status: 403 },
  );
  await assert.rejects(
    origin.createEmbedToken(
      { ...site, id: "other" },
      "http://support.local/preview",
      preview,
    ),
    { status: 403 },
  );
  await assert.rejects(
    origin.createEmbedToken(
      site,
      "http://support.local/preview",
      preview + "tampered",
    ),
    { status: 403 },
  );
});

test("visitor access stops when the visitor is blocked or site is disabled", async () => {
  const record = {
    siteId: "s1",
    blocked: false,
    site: { active: true, tenant: { status: "ACTIVE", expiresAt: null } },
  };
  const visitorAuth = loadModule("src/lib/visitor-auth.ts", {
    "../server/services/tenants": tenants,
    jose,
    "./env": { env },
    "./db": { prisma: { visitor: { findUnique: async () => record } } },
  });
  const token = await visitorAuth.signVisitorToken({
    visitorId: "v1",
    siteId: "s1",
    email: "v@example.com",
    localKey: "local-key",
  });
  assert.equal((await visitorAuth.verifyVisitorToken(token)).visitorId, "v1");
  record.blocked = true;
  assert.equal(await visitorAuth.verifyVisitorToken(token), null);
  record.blocked = false;
  record.site.active = false;
  assert.equal(await visitorAuth.verifyVisitorToken(token), null);
});

test("staff JWTs require tokenVersion and stop working after password reset", async () => {
  const user = {
    id: "a1",
    active: true,
    tokenVersion: 0,
    tenantId: "tenant1",
    tenant: { status: "ACTIVE", expiresAt: null, sites: [{ id: "s1" }] },
    role: "AGENT",
    sites: [{ siteId: "s1" }],
  };
  const staff = loadModule("src/lib/auth.ts", {
    bcryptjs: {},
    jose,
    "next/headers": {},
    react: { cache: (fn) => fn },
    "./env": { env },
    "./db": { prisma: { user: { findUnique: async () => user } } },
    "./realtime/emit": {},
  });
  const token = await staff.signSessionToken({
    userId: "a1",
    role: "AGENT",
    tokenVersion: 0,
  });
  assert.equal((await staff.resolveUserFromToken(token)).id, "a1");
  user.emailVerificationRequired = true;
  assert.equal(await staff.resolveUserFromToken(token), null);
  user.emailVerifiedAt = new Date();
  assert.equal((await staff.resolveUserFromToken(token)).id, "a1");
  user.tokenVersion += 1;
  assert.equal(await staff.resolveUserFromToken(token), null);
  const legacy = await new jose.SignJWT({ role: "ADMIN" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("a1")
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(env.AUTH_SECRET));
  assert.equal(await staff.resolveUserFromToken(legacy), null);
});

test("returning visitors keep the previous lastSeenAt until visit counting", async () => {
  const record = {
    lastSeenAt: new Date(Date.now() - 31 * 60_000),
    meta: {},
    landingPage: "https://shop.example.com",
    lastPage: "https://shop.example.com",
    referrer: null,
  };
  let data;
  const visitorDb = {
    $queryRaw: async () => [],
    $transaction: async (callback) => callback(visitorDb),
    visitor: {
      findUnique: async () => record,
      update: async (input) => {
        data = input.data;
      },
    },
  };
  const visitors = loadModule("src/server/services/visitors.ts", {
    "../../lib/db": { prisma: visitorDb },
    "../../lib/visitor-env": {
      mergeVisitorEnv: (left, right) => ({ ...left, ...right }),
    },
  });
  await visitors.touchVisitorOnSession({
    visitorId: "v1",
    env: {},
    pageUrl: "https://shop.example.com",
  });
  assert.deepEqual(data.visitCount, { increment: 1 });
  assert.equal(data.pageViews, undefined);
});
