import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule, auth } from "./load-module.mjs";

class NextResponse extends Response {
  static json(data, init) {
    return new NextResponse(JSON.stringify(data), init);
  }
}
const api = loadModule("src/lib/api.ts", {
  "next/server": { NextResponse },
  zod: { ZodError: class extends Error {} },
  "./auth": auth,
});
const post = (body, headers) =>
  new Request("http://test.local/api", { method: "POST", body, headers });

test("JSON requests reject malformed content with 400 and accept optional empty bodies only", async () => {
  assert.deepEqual(await api.readJson(post('{"message":"你好"}')), {
    message: "你好",
  });
  for (const body of [undefined, "", "{broken", new Uint8Array([0xff])]) {
    try {
      await api.readJson(post(body));
      assert.fail("invalid JSON should fail");
    } catch (error) {
      assert.equal(api.toErrorResponse(error).status, 400);
    }
  }
  assert.deepEqual(await api.readJson(post(undefined), true), {});
  assert.deepEqual(await api.readJson(post(""), true), {});
  await assert.rejects(api.readJson(post("invalid"), true), { status: 400 });
});

test("JSON limits count UTF-8 bytes and enforce chunked bodies without trusting headers", async () => {
  const valid = JSON.stringify({ text: "中".repeat(20_000) });
  assert.equal((await api.readJson(post(valid))).text.length, 20_000);
  const oversized = JSON.stringify({ text: "中".repeat(22_000) });
  for (const headers of [
    undefined,
    { "content-length": "1" },
    { "content-length": "999999" },
  ])
    await assert.rejects(api.readJson(post(oversized, headers)), {
      status: 413,
    });
  let cancelled = false;
  let chunks = 0;
  const body = new ReadableStream({
    pull(controller) {
      chunks += 1;
      controller.enqueue(new Uint8Array(16_384));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    api.readJson(
      new Request("http://test.local/api", {
        method: "POST",
        body,
        duplex: "half",
      }),
    ),
    { status: 413 },
  );
  assert.equal(cancelled, true);
  assert.ok(chunks < 10);
});
