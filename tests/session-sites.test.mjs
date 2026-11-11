import { test } from "node:test";
import assert from "node:assert/strict";
import * as jose from "jose";
import { loadModule } from "./load-module.mjs";

const env = {
  AUTH_SECRET: "unit-test-signing-key-0123456789abcdef",
  APP_URL: "http://test.local",
};

const account = (role, tenantStatus = "ACTIVE") => ({
  id: "u1",
  email: "u1@example.com",
  name: "U1",
  role,
  active: true,
  tokenVersion: 0,
  tenantId: "tenant1",
  tenant: { status: tenantStatus, expiresAt: null },
  sites: [{ siteId: "s1" }],
});

function sessionFixture(user) {
  const queries = { include: null, sites: [] };
  const staff = loadModule("src/lib/auth.ts", {
    bcryptjs: {},
    jose,
    "next/headers": {},
    react: { cache: (fn) => fn },
    "./env": { env },
    "./db": {
      prisma: {
        user: {
          findUnique: async ({ include }) => {
            queries.include = include;
            return user;
          },
        },
        site: {
          findMany: async ({ where }) => {
            queries.sites.push(where);
            return [{ id: "s1" }, { id: "s2" }, { id: "s3" }];
          },
        },
      },
    },
    "./realtime/emit": {},
  });
  const resolve = async () =>
    staff.resolveUserFromToken(
      await staff.signSessionToken({
        userId: user.id,
        role: user.role,
        tokenVersion: user.tokenVersion,
      }),
    );
  return { queries, resolve };
}

test("only merchant administrators load the tenant's sites on each request", async () => {
  const agent = sessionFixture(account("AGENT"));
  assert.deepEqual((await agent.resolve()).siteIds, ["s1"]);
  assert.deepEqual(agent.queries.sites, []);
  // The account query itself no longer pulls the tenant's sites along.
  assert.deepEqual(agent.queries.include.tenant, {
    select: { status: true, expiresAt: true },
  });

  const admin = sessionFixture(account("ADMIN"));
  assert.equal((await admin.resolve()).siteIds, null);
  assert.deepEqual(admin.queries.sites, []);

  const merchant = sessionFixture(account("MERCHANT_ADMIN"));
  assert.deepEqual((await merchant.resolve()).siteIds, ["s1", "s2", "s3"]);
  assert.deepEqual(merchant.queries.sites, [{ tenantId: "tenant1" }]);

  // A suspended tenant is refused before the site list is read.
  const suspended = sessionFixture(account("MERCHANT_ADMIN", "SUSPENDED"));
  assert.equal(await suspended.resolve(), null);
  assert.deepEqual(suspended.queries.sites, []);
});
