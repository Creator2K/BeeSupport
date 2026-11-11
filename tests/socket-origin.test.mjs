import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./load-module.mjs";

const { isSocketOriginAllowed, parseSocketOrigins } = loadModule(
  "src/server/socket-origin.ts",
);

test("configured origins are normalised and invalid entries dropped", () => {
  assert.deepEqual(
    parseSocketOrigins(
      "https://support.example.com/admin",
      " https://a.example.com , ftp://b.example.com, not a url,,https://support.example.com",
      undefined,
    ),
    ["https://support.example.com", "https://a.example.com"],
  );
  assert.deepEqual(parseSocketOrigins(undefined, ""), []);
});

test("realtime handshakes are accepted only from the app's own origin", () => {
  const allowedOrigins = ["https://support.example.com"];
  const check = (origin, host) =>
    isSocketOriginAllowed({ origin, host, allowedOrigins });

  // Same-origin polling requests and non-browser clients send no Origin.
  assert.equal(check(undefined, "127.0.0.1:3000"), true);
  // Behind a proxy that rewrites Host, APP_URL still identifies the app.
  assert.equal(check("https://support.example.com", "127.0.0.1:3000"), true);
  // Other hostnames that reach the app directly are same-origin by Host.
  assert.equal(check("http://192.168.1.168:3000", "192.168.1.168:3000"), true);
  assert.equal(check("http://LOCALHOST:3000", "localhost:3000"), true);
  assert.equal(check("https://alt.example.com", "alt.example.com:443"), true);
  assert.equal(check("http://[::1]:3000", "[::1]:3000"), true);

  // A sibling subdomain shares the cookie's site but is a different origin.
  assert.equal(check("https://evil.example.com", "support.example.com"), false);
  assert.equal(check("https://support.example.com.evil.test", "support.example.com"), false);
  assert.equal(check("http://192.168.1.168:8080", "192.168.1.168:3000"), false);
  assert.equal(check("null", "support.example.com"), false);
  assert.equal(check("file://", "support.example.com"), false);
  assert.equal(check("https://evil.example.com", undefined), false);
});
