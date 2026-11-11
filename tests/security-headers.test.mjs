import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./load-module.mjs";

const { securityHeaders } = loadModule("src/server/security-headers.ts");

test("only the widget page may be framed by another origin", () => {
  for (const path of ["/", "/admin", "/console-7f3a", "/agent", "/login", "/widgets", "/widget.js", "/api/files/1"]) {
    const headers = securityHeaders(path, { https: false });
    assert.equal(headers["x-frame-options"], "SAMEORIGIN", path);
    assert.equal(headers["content-security-policy"], "frame-ancestors 'self'", path);
    assert.equal(headers["x-content-type-options"], "nosniff", path);
  }
  for (const path of ["/widget", "/widget/"]) {
    const headers = securityHeaders(path, { https: false });
    assert.equal("x-frame-options" in headers, false, path);
    assert.equal("content-security-policy" in headers, false, path);
    assert.equal(headers["x-content-type-options"], "nosniff", path);
  }
});

test("HSTS is sent only when the app is configured for HTTPS", () => {
  assert.equal(
    "strict-transport-security" in securityHeaders("/", { https: false }),
    false,
  );
  assert.equal(
    securityHeaders("/widget", { https: true })["strict-transport-security"],
    "max-age=15552000",
  );
});
