import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { loadModule, nextTurn } from "./load-module.mjs";

function fixture(endpoints = []) {
  const updates = [];
  const delays = [];
  const retry = loadModule("src/server/retry.ts", {
    "node:timers/promises": {
      setTimeout: async (ms) => {
        delays.push(ms);
      },
    },
  });
  const hooks = loadModule("src/lib/webhooks.ts", {
    "./public-webhook": {
      postPublicWebhook: (...args) => globalThis.fetch(...args),
    },
    "./db": {
      prisma: {
        site: { findUnique: async () => ({ tenantId: "legacy" }) },
        webhookEndpoint: {
          findMany: async () => endpoints,
          update: async (input) => {
            updates.push(input);
          },
          updateMany: async (input) => {
            updates.push(input);
            return { count: 1 };
          },
        },
      },
    },
    "../server/retry": retry,
  });
  return { ...hooks, retry, updates, delays };
}

async function withFetch(fetch, callback) {
  const saved = globalThis.fetch;
  const savedError = console.error;
  globalThis.fetch = fetch;
  console.error = () => {};
  try {
    await callback();
  } finally {
    globalThis.fetch = saved;
    console.error = savedError;
  }
}

const payload = {
  event: "message.created",
  siteId: "s1",
  siteName: "Shop",
  title: "New message",
  text: "Hello",
};
const endpoint = (type = "GENERIC", id = "hook") => ({
  id,
  tenantId: "legacy",
  type,
  name: id,
  url: `https://hook.example/${id}`,
  secret: "test-secret",
  events: [],
});

test("HTTP 200 with a provider business error is reported as failed", async () => {
  const hooks = fixture();
  for (const [type, response] of [
    ["DINGTALK", { errcode: 310000, errmsg: "invalid signature" }],
    ["WECHAT_WORK", { errcode: 93000, errmsg: "invalid webhook" }],
    ["TELEGRAM", { ok: false, error_code: 400, description: "chat not found" }],
    ["WECHAT", { ok: false, error: "bridge failed" }],
  ]) {
    await withFetch(
      async () => Response.json(response),
      async () => {
        const result = await hooks.testWebhook(
          type,
          "https://hook.example",
          null,
          "s1",
          "Shop",
        );
        assert.equal(result.ok, false);
        assert.ok(result.error);
      },
    );
  }
});

test("valid provider acknowledgements and custom HTTP 204 webhooks succeed", async () => {
  const hooks = fixture();
  for (const [type, response] of [
    ["DINGTALK", { errcode: 0, errmsg: "ok" }],
    ["WECHAT_WORK", { errcode: 0 }],
    ["TELEGRAM", { ok: true, result: { message_id: 1 } }],
    ["WECHAT", { ok: true }],
  ]) {
    await withFetch(
      async () => Response.json(response),
      async () => {
        assert.equal(
          (
            await hooks.testWebhook(
              type,
              "https://hook.example",
              null,
              "s1",
              "Shop",
            )
          ).ok,
          true,
        );
      },
    );
  }
  await withFetch(
    async () => new Response(null, { status: 204 }),
    async () => {
      assert.equal(
        (
          await hooks.testWebhook(
            "GENERIC",
            "https://hook.example",
            null,
            "s1",
            "Shop",
          )
        ).ok,
        true,
      );
    },
  );
});

test("permanent HTTP and provider errors are recorded without repeated sends", async () => {
  for (const [type, response] of [
    ["GENERIC", () => new Response("unauthorized", { status: 401 })],
    [
      "DINGTALK",
      () => Response.json({ errcode: 310000, errmsg: "invalid signature" }),
    ],
  ]) {
    const hooks = fixture([endpoint(type)]);
    let calls = 0;
    await withFetch(
      async () => {
        calls += 1;
        return response();
      },
      async () => hooks.dispatchWebhooks(payload),
    );
    assert.equal(calls, 1);
    assert.equal(hooks.delays.length, 0);
    assert.match(hooks.updates.at(-1).data.lastStatus, /^error:/);
  }
});

test("temporary HTTP failures retry with bounded backoff and eventually record success", async () => {
  for (const status of [429, 503]) {
    const hooks = fixture([endpoint()]);
    let calls = 0;
    await withFetch(
      async () => {
        calls += 1;
        return calls < 3
          ? new Response("retry", { status })
          : new Response(null, { status: 204 });
      },
      async () => hooks.dispatchWebhooks(payload),
    );
    assert.equal(calls, 3);
    assert.deepEqual(hooks.delays, [500, 1000]);
    assert.equal(hooks.updates.at(-1).data.lastStatus, "ok");
  }
});

test("unrecoverable transport failure stops after three attempts", async () => {
  const hooks = fixture([endpoint()]);
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      throw new Error("connection lost");
    },
    async () => hooks.dispatchWebhooks(payload),
  );
  assert.equal(calls, 3);
  assert.equal(hooks.delays.length, 2);
  assert.match(hooks.updates.at(-1).data.lastStatus, /connection lost/);
});

test("fan-out bounds concurrent requests and delivers every subscribed endpoint", async () => {
  const endpoints = Array.from({ length: 23 }, (_, i) =>
    endpoint("GENERIC", `hook-${i}`),
  );
  endpoints.push({
    ...endpoint("GENERIC", "excluded"),
    events: ["conversation.closed"],
  });
  const hooks = fixture(endpoints);
  let active = 0;
  let peak = 0;
  const sent = new Set();
  await withFetch(
    async (url) => {
      active += 1;
      peak = Math.max(peak, active);
      sent.add(url);
      await nextTurn();
      active -= 1;
      return new Response(null, { status: 204 });
    },
    async () => hooks.dispatchWebhooks(payload),
  );
  assert.equal(peak, 4);
  assert.equal(sent.size, 23);
  assert.equal(hooks.updates.length, 23);
});

test("large chunked error responses are cancelled before unbounded buffering", async () => {
  const hooks = fixture();
  let reads = 0;
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      reads += 1;
      controller.enqueue(new Uint8Array(4096));
    },
    cancel() {
      cancelled = true;
    },
  });
  await withFetch(
    async () => new Response(body, { status: 503 }),
    async () => {
      const result = await hooks.testWebhook(
        "GENERIC",
        "https://hook.example",
        null,
        "s1",
        "Shop",
      );
      assert.equal(result.ok, false);
      assert.match(result.error, /16 KiB/);
    },
  );
  assert.equal(cancelled, true);
  assert.ok(reads < 10);
});

test("malformed success acknowledgements are rejected and custom signatures still cover exact request bytes", async () => {
  const hooks = fixture([endpoint()]);
  await withFetch(
    async () => new Response("not JSON"),
    async () => {
      assert.equal(
        (
          await hooks.testWebhook(
            "TELEGRAM",
            "https://hook.example",
            null,
            "s1",
            "Shop",
          )
        ).ok,
        false,
      );
    },
  );
  await withFetch(
    async (_url, options) => {
      assert.equal(
        options.headers["x-beesupport-signature"],
        createHmac("sha256", "test-secret").update(options.body).digest("hex"),
      );
      assert.equal(JSON.parse(options.body).event, "message.created");
      return new Response(null, { status: 204 });
    },
    async () => hooks.dispatchWebhooks(payload),
  );
});

test("an interrupted success response can retry while malformed JSON cannot", async () => {
  const hooks = fixture([endpoint("TELEGRAM")]);
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      if (calls === 1)
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError("response connection lost"));
            },
          }),
        );
      return Response.json({ ok: true });
    },
    async () => hooks.dispatchWebhooks(payload),
  );
  assert.equal(calls, 2);
  assert.equal(hooks.updates.at(-1).data.lastStatus, "ok");
  const malformed = fixture([endpoint("TELEGRAM")]);
  calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      return new Response("broken JSON");
    },
    async () => malformed.dispatchWebhooks(payload),
  );
  assert.equal(calls, 1);
  assert.match(malformed.updates.at(-1).data.lastStatus, /^error:/);
});

test("webhook and email jobs are queued independently, with escaped email content", async () => {
  let finishWebhook;
  let sent = null;
  const notifications = loadModule("src/server/services/notifications.ts", {
    "../../lib/env": { env: { APP_URL: "https://support.example" } },
    "./notification-outbox": {
      enqueueMail: async (input) => {
        sent = input;
      },
      enqueueWebhooks: () =>
        new Promise((resolve) => {
          finishWebhook = resolve;
        }),
    },
  });
  const pending = notifications.notifyConversationCreated({
    conversationId: "c1",
    siteId: "s1",
    siteName: "Shop",
    notifyEmail: "staff@example.com",
    visitorEmail: "visitor@example.com",
    visitorName: "<visitor>",
    subject: null,
    preview: "<script>alert(1)</script>",
    offline: true,
  });
  await nextTurn();
  assert.equal(sent.to, "staff@example.com");
  assert.match(sent.html, /&lt;script&gt;/);
  assert.doesNotMatch(sent.html, /<script>/);
  finishWebhook();
  await pending;
});
