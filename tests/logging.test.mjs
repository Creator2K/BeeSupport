import { test } from "node:test";
import assert from "node:assert/strict";

import { loadModule } from "./load-module.mjs";

const requestContext = {
  getRequestContext: () => ({
    requestId: "req-test-123",
    method: "POST",
    path: "/api/test",
    startedAt: Date.now() - 25,
  }),
};
const { buildLogRecord, redactLogText } = loadModule("src/lib/logger.ts", {
  "../server/request-context": requestContext,
});

test("structured logs attach request context and redact secrets", () => {
  const circular = { safe: "visible" };
  circular.self = circular;
  const record = buildLogRecord(
    "error",
    "test.failure",
    {
      requestId: "spoofed",
      authorization: "Bearer should-not-leak",
      nested: {
        apiKey: "secret-value",
        database: "postgresql://user:password@db.local/app",
      },
      circular,
      values: Array.from({ length: 25 }, (_, index) => index),
    },
    new Error("redis://:secret@cache failed with gho_abcdefghijklmnop"),
  );
  const serialized = JSON.stringify(record);

  assert.equal(record.requestId, "req-test-123");
  assert.equal(record.method, "POST");
  assert.equal(record.path, "/api/test");
  assert.equal(record.service, "beesupport");
  assert.equal(record.authorization, "[REDACTED]");
  assert.equal(record.nested.apiKey, "[REDACTED]");
  assert.equal(record.circular.self, "[CIRCULAR]");
  assert.equal(record.values.length, 20);
  assert.doesNotMatch(serialized, /should-not-leak|secret-value|user:password|gho_/);
  assert.match(record.error.message, /redis:\/\/\[REDACTED\]@cache/);
});

test("plain strings redact connection credentials, bearer tokens and API keys", () => {
  const output = redactLogText(
    "postgresql://user:pass@db/app redis://:pass@cache Bearer abc sk-123456789012345",
  );
  assert.doesNotMatch(output, /user:pass|:pass@|Bearer abc|sk-123/);
  assert.match(output, /postgresql:\/\/\[REDACTED\]@db/);
  assert.match(output, /redis:\/\/\[REDACTED\]@cache/);
});

test("request contexts stay isolated across concurrent async work", async () => {
  const { getRequestContext, requestPath, runWithRequestContext } = loadModule(
    "src/server/request-context.ts",
  );
  const readAfterDelay = (requestId, delay) =>
    runWithRequestContext(
      {
        requestId,
        method: "GET",
        path: requestPath(`/${requestId}?token=hidden`),
        startedAt: Date.now(),
      },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return getRequestContext();
      },
    );

  const [first, second] = await Promise.all([
    readAfterDelay("request-a", 20),
    readAfterDelay("request-b", 5),
  ]);
  assert.equal(first.requestId, "request-a");
  assert.equal(first.path, "/request-a");
  assert.equal(second.requestId, "request-b");
  assert.equal(second.path, "/request-b");
  assert.equal(getRequestContext(), undefined);
});
