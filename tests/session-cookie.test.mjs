import { test } from "node:test";
import assert from "node:assert/strict";
import * as jose from "jose";
import { loadModule } from "./load-module.mjs";

async function sessionCookie(appUrl, forwardedProto) {
  const cookies = [];
  const staff = loadModule("src/lib/auth.ts", {
    bcryptjs: {},
    jose,
    "next/headers": {
      cookies: async () => ({
        set: (name, value, options) => cookies.push({ name, value, options }),
      }),
      headers: async () =>
        new Headers(
          forwardedProto === undefined
            ? {}
            : { "x-forwarded-proto": forwardedProto },
        ),
    },
    react: { cache: (fn) => fn },
    "./env": {
      env: { AUTH_SECRET: "regression-test-secret-only-123456", APP_URL: appUrl },
    },
    "./db": { prisma: {} },
    "./realtime/emit": {},
  });
  await staff.createSession("a1", "AGENT", 0);
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].name, staff.SESSION_COOKIE);
  assert.equal(cookies[0].options.httpOnly, true);
  assert.equal(cookies[0].options.sameSite, "lax");
  return cookies[0].options;
}

test("intranet http deployments keep a cookie the browser will accept", async () => {
  const lan = "http://192.168.1.20:3000";
  assert.equal((await sessionCookie(lan, undefined)).secure, false);
  assert.equal((await sessionCookie(lan, "http")).secure, false);
  // 浏览器到第一跳是明文，后面的代理之间走 https 不算
  assert.equal((await sessionCookie(lan, "http, https")).secure, false);
});

test("the session cookie is Secure whenever the request arrived over HTTPS", async () => {
  const lan = "http://192.168.1.20:3000";
  assert.equal((await sessionCookie(lan, "https")).secure, true);
  assert.equal((await sessionCookie(lan, "HTTPS")).secure, true);
  assert.equal((await sessionCookie(lan, "https, http")).secure, true);
});

test("an https APP_URL always marks the session cookie Secure", async () => {
  const site = "https://chat.example.com";
  assert.equal((await sessionCookie(site, undefined)).secure, true);
  assert.equal((await sessionCookie(site, "http")).secure, true);
});
