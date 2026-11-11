import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { HttpError, loadModule } from "./load-module.mjs";

const MB = 1_048_576;
const nextServer = {
  NextResponse: {
    json: (body, init) => new Response(JSON.stringify(body), init),
  },
};
const rethrow = (error) => {
  throw error;
};
const memoryLimiter = () =>
  loadModule("src/lib/rate-limit.ts", { "./redis": { getRedis: () => null } });

test("rate limits can charge a weighted cost per call", async () => {
  const { rateLimit } = memoryLimiter();
  assert.deepEqual(
    [
      (await rateLimit("budget", 200, 3600, 150)).ok,
      (await rateLimit("budget", 200, 3600, 50)).ok,
      (await rateLimit("budget", 200, 3600, 1)).ok,
      (await rateLimit("other", 200, 3600, 201)).ok,
    ],
    [true, true, false, false],
  );
  // Callers that pass no cost keep counting requests.
  assert.equal((await rateLimit("count", 2, 60)).remaining, 1);
  assert.equal((await rateLimit("count", 2, 60)).ok, true);
  assert.equal((await rateLimit("count", 2, 60)).ok, false);

  const calls = [];
  const redisLimiter = loadModule("src/lib/rate-limit.ts", {
    "./redis": {
      getRedis: () => ({
        eval: async (...args) => {
          calls.push(args);
          return 180;
        },
      }),
    },
  });
  const result = await redisLimiter.rateLimit("budget", 200, 3600, 30);
  assert.equal(result.ok, true);
  assert.equal(result.remaining, 20);
  assert.match(calls[0][0], /INCRBY/);
  assert.deepEqual(calls[0].slice(3), [3601, 30]);
});

function uploadFixture() {
  const state = { unsent: 0, saved: 0, visitor: 0, heldSlots: 0, slotKeys: [] };
  const tx = {
    attachment: {
      count: async ({ where }) => {
        assert.deepEqual(where, {
          siteId: "site",
          uploader: "VISITOR",
          uploaderId: `visitor-${state.visitor}`,
          messageId: null,
        });
        return state.unsent;
      },
      create: async ({ data }) => ({ id: `attachment-${state.saved}`, ...data }),
    },
  };
  const route = loadModule("src/app/api/widget/upload/route.ts", {
    "next/server": nextServer,
    "@/lib/api": { toErrorResponse: rethrow },
    "@/lib/auth": { HttpError },
    "@/lib/db": { prisma: { $transaction: async (run) => run(tx) } },
    "@/lib/rate-limit": memoryLimiter(),
    "@/lib/storage": {
      acquireUploadSlot: async (key) => {
        state.slotKeys.push(key);
        state.heldSlots += 1;
        return () => {
          state.heldSlots -= 1;
        };
      },
      deleteUpload: async () => {},
      readUploadForm: async (request) => {
        // The body is only read while a slot is held.
        assert.equal(state.heldSlots, 1);
        return request.formData();
      },
      saveUpload: async (file) => {
        state.saved += 1;
        return {
          storageKey: `site/2026/11/${state.saved}.txt`,
          filename: file.name,
          mimeType: file.type,
          size: file.size,
        };
      },
    },
    "@/server/services/risk": {
      assertVisitorContentAllowed: async () => {},
      verifyVisitorRequest: async () => ({
        visitorId: `visitor-${state.visitor}`,
        siteId: "site",
      }),
    },
    "@/server/services/image-review": {
      assertImageUploadSlot: async () => false,
      emitImageGate: async () => {},
    },
    "@/server/services/tenants": {
      assertTenantQuota: async () => {},
      assertSiteServing: async () => ({ id: "tenant" }),
      assertVisitorUploadAllowed: async () => {},
    },
    "@/server/serialize": { serializeAttachment: (attachment) => attachment },
  });
  const upload = (ip, megabytes) => {
    const file = new File(["x"], "note.txt", { type: "text/plain" });
    // Report a large size without allocating it.
    Object.defineProperty(file, "size", { value: megabytes * MB });
    return route.POST({
      headers: new Headers({ "x-beesupport-client-ip": ip }),
      formData: async () => ({ get: () => file }),
    });
  };
  return { state, upload };
}

test("visitor uploads are capped by unsent count and by size per address", async () => {
  const { state, upload } = uploadFixture();

  assert.equal((await upload("203.0.113.1", 20)).status, 200);
  state.unsent = 10;
  await assert.rejects(upload("203.0.113.1", 1), (error) => {
    assert.equal(error.status, 429);
    assert.match(error.message, /未发送的附件过多/);
    return true;
  });
  assert.equal(state.saved, 1);
  state.unsent = 0;

  // Rotating visitor identities does not reset the address budget (200 MB / hour).
  for (let index = 0; index < 9; index += 1) {
    state.visitor += 1;
    assert.equal((await upload("203.0.113.2", 20)).status, 200);
  }
  state.visitor += 1;
  assert.equal((await upload("203.0.113.2", 20)).status, 200);
  state.visitor += 1;
  await assert.rejects(upload("203.0.113.2", 1), (error) => {
    assert.equal(error.status, 429);
    assert.match(error.message, /文件总量过大/);
    return true;
  });
  assert.equal(state.saved, 11);
  assert.equal((await upload("203.0.113.3", 20)).status, 200);

  // Slots are taken per address and given back after rejected uploads too.
  assert.equal(state.heldSlots, 0);
  assert.equal(state.slotKeys.length, 14);
  assert.deepEqual(
    [...new Set(state.slotKeys)],
    [
      "visitor-ip:203.0.113.1",
      "visitor-ip:203.0.113.2",
      "visitor-ip:203.0.113.3",
    ],
  );
});

test("one address cannot open unlimited new conversations", async () => {
  const state = { visitor: 0, active: null, created: 0 };
  const route = loadModule("src/app/api/widget/conversation/route.ts", {
    "next/server": nextServer,
    zod: { z },
    "@/lib/api": { readJson: (request) => request.json(), toErrorResponse: rethrow },
    "@/lib/auth": { HttpError },
    "@/lib/db": {
      prisma: {
        site: { findUnique: async () => ({ id: "site", name: "Site" }) },
        visitor: {
          findUnique: async ({ where }) => ({ id: where.id, email: "", name: null }),
        },
        conversation: {
          findFirst: async ({ where }) => {
            assert.deepEqual(where.status, { in: ["PENDING", "OPEN"] });
            return state.active;
          },
        },
      },
    },
    "@/lib/rate-limit": memoryLimiter(),
    "@/server/services/risk": {
      assertVisitorContentAllowed: async () => {},
      verifyVisitorRequest: async () => ({
        visitorId: `visitor-${(state.visitor += 1)}`,
        siteId: "site",
      }),
    },
    "@/server/services/conversations": {
      createConversationForVisitor: async () => {
        state.created += 1;
        return { conversationId: "conversation", created: true };
      },
      getVisitorConversationState: async () => ({}),
    },
    "@/server/services/messages": { postVisitorMessage: async () => {} },
  });
  const send = (ip) =>
    route.POST(
      new Request("http://app.test/api/widget/conversation", {
        method: "POST",
        headers: { "x-beesupport-client-ip": ip },
        body: JSON.stringify({ body: "hello" }),
      }),
    );

  for (let index = 0; index < 60; index += 1)
    assert.equal((await send("203.0.113.1")).status, 200);
  await assert.rejects(send("203.0.113.1"), (error) => {
    assert.equal(error.status, 429);
    assert.match(error.message, /发起的会话过多/);
    return true;
  });
  assert.equal(state.created, 60);

  // Messages into a conversation that is already open are not new conversations.
  state.active = { id: "conversation" };
  assert.equal((await send("203.0.113.1")).status, 200);
  state.active = null;
  assert.equal((await send("203.0.113.2")).status, 200);
  assert.equal(state.created, 62);
});

test("the public widget config is limited per source before any site lookup", async () => {
  const state = { siteLookups: 0 };
  const route = loadModule("src/app/api/widget/config/route.ts", {
    "next/server": nextServer,
    "@/lib/api": { toErrorResponse: rethrow },
    "@/lib/auth": { HttpError },
    "@/lib/rate-limit": memoryLimiter(),
    "@/lib/widget": {
      resolveSiteByKey: async (key) => {
        state.siteLookups += 1;
        return { id: "site", name: "Site", publicKey: key };
      },
      getSiteAvailability: async () => ({ online: true }),
    },
    "@/lib/i18n/config": { resolveLocaleFromHeader: () => "zh-CN" },
    "@/lib/widget-origin": { assertWidgetOriginAllowed: async () => {} },
    "@/server/services/tenants": { getWidgetSettings: async () => ({}) },
  });
  const load = (ip) =>
    route.GET(
      new Request("http://app.test/api/widget/config?key=pk", {
        headers: { "x-beesupport-client-ip": ip },
      }),
    );

  // Addresses inside one IPv6 /64 count as one source.
  for (let index = 0; index < 600; index += 1)
    assert.equal(
      (await load(`2001:db8:1:2::${(index + 1).toString(16)}`)).status,
      200,
    );
  await assert.rejects(load("2001:db8:1:2:ffff::1"), (error) => {
    assert.equal(error.status, 429);
    assert.match(error.message, /过于频繁/);
    return true;
  });
  assert.equal(state.siteLookups, 600);

  const other = await load("2001:db8:1:3::1");
  assert.equal(other.status, 200);
  assert.equal((await other.json()).site.publicKey, "pk");
});

test("unsent uploads older than a day are removed with their files", async () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const rows = [
    { id: "a", storageKey: "site/2026/11/a.png", messageId: null },
    { id: "b", storageKey: "site/2026/11/b.png", messageId: null },
  ];
  const deletedFiles = [];
  const cutoffs = [];
  const { cleanupUnsentAttachments, UNSENT_UPLOAD_RETENTION_MS } = loadModule(
    "src/server/services/upload-cleanup.ts",
    {
      "../../lib/db": {
        prisma: {
          attachment: {
            findMany: async ({ where }) => {
              assert.equal(where.messageId, null);
              cutoffs.push(where.createdAt.lt.toISOString());
              return rows.filter((row) => row.messageId === null);
            },
            deleteMany: async ({ where }) => {
              assert.equal(where.messageId, null);
              // "b" is sent between the listing and the delete.
              const index = rows.findIndex((row) => row.id === where.id);
              if (where.id === "b") {
                rows[index].messageId = "message";
                return { count: 0 };
              }
              rows.splice(index, 1);
              return { count: 1 };
            },
          },
        },
      },
      "../../lib/logger": { logger: { error: () => {} } },
      "../../lib/storage": {
        deleteUpload: async (key) => {
          deletedFiles.push(key);
        },
      },
    },
  );

  assert.equal(await cleanupUnsentAttachments({ now }), 1);
  assert.deepEqual(deletedFiles, ["site/2026/11/a.png"]);
  assert.equal(UNSENT_UPLOAD_RETENTION_MS, 86_400_000);
  assert.deepEqual(cutoffs, ["2026-11-10T12:00:00.000Z"]);
  assert.equal(
    await cleanupUnsentAttachments({ now, shouldStop: () => true }),
    0,
  );
});
