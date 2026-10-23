import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./load-module.mjs";
const { createClientIpResolver, setClientIp, CLIENT_IP_HEADER } = loadModule(
  "src/server/client-ip.ts",
);

test("direct connections overwrite spoofed IP headers with the socket peer", () => {
  const req = {
    socket: { remoteAddress: "::ffff:192.168.1.25" },
    headers: {
      "x-forwarded-for": "203.0.113.9",
      [CLIENT_IP_HEADER]: "forged",
      "cf-connecting-ip": "fake",
    },
  };
  setClientIp(req, createClientIpResolver());
  assert.equal(req.headers[CLIENT_IP_HEADER], "192.168.1.25");
  const { clientIp } = loadModule("src/lib/rate-limit.ts", {
    "./redis": { getRedis: () => null },
  });
  assert.equal(clientIp(new Headers(req.headers)), "192.168.1.25");
});

test("only configured proxy hops are trusted, walking the chain from the right", () => {
  const resolve = createClientIpResolver("127.0.0.1/32,10.0.0.0/8,::1/128");
  assert.equal(resolve("127.0.0.1", "forged, 203.0.113.1"), "127.0.0.1");
  assert.equal(
    resolve("127.0.0.1", "198.51.100.9, 203.0.113.1, 10.0.0.3"),
    "203.0.113.1",
  );
  assert.equal(resolve("::1", "2001:db8::9"), "2001:db8::9");
  assert.equal(resolve("192.168.1.20", "203.0.113.1"), "192.168.1.20");
});

test("invalid proxy configuration fails startup instead of silently trusting clients", () => {
  for (const entry of [
    "*",
    "example.com",
    "127.0.0.1/33",
    "::1/129",
    "10.0.0.1/",
    "127.0.0.1/0/extra",
  ]) {
    assert.throws(() => createClientIpResolver(entry), /TRUSTED_PROXY_CIDRS/);
  }
});
