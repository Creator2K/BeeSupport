import { test } from "node:test";
import assert from "node:assert/strict";
import { auth, loadModule, nextTurn } from "./load-module.mjs";

const loadStorage = (limit, authModule = auth) =>
  loadModule("src/lib/storage.ts", {
    "./auth": authModule,
    "./env": {
      env: {
        UPLOAD_DIR: "unused",
        UPLOAD_MAX_BYTES: 64,
        UPLOAD_MAX_CONCURRENT: limit,
      },
    },
  });

/** Records when an acquire settles, so a test can tell "still waiting" from "granted". */
function track(promise, name, order) {
  const record = { granted: false, release: undefined };
  promise.then(
    (release) => {
      if (!release) return;
      record.granted = true;
      record.release = release;
      order?.push(name);
    },
    () => {},
  );
  return record;
}

test("the shared upload gate follows UPLOAD_MAX_CONCURRENT and counts per process", async () => {
  delete globalThis.__beeUploadGate;
  try {
    // The custom server and the route bundles each load their own copy of the module.
    const first = loadStorage(2);
    const second = loadStorage(2);
    const releaseA = await first.acquireUploadSlot("a");
    const releaseB = await second.acquireUploadSlot("b");

    const third = track(first.acquireUploadSlot("c"));
    await nextTurn();
    assert.equal(third.granted, false);

    releaseA();
    await nextTurn();
    assert.equal(third.granted, true);
    releaseB();
    third.release();
  } finally {
    delete globalThis.__beeUploadGate;
  }
});

test("a busy gate answers 503 with the error type of the module copy that asked", async () => {
  delete globalThis.__beeUploadGate;
  try {
    // Whichever copy loads first owns the gate; here it is not the route's copy.
    globalThis.__beeUploadGate = loadStorage(4).createUploadGate({
      limit: 1,
      waitMs: 10,
      maxWaiting: 1,
    });
    class RouteHttpError extends Error {
      constructor(status, message) {
        super(message);
        this.status = status;
      }
    }
    const route = loadStorage(4, { HttpError: RouteHttpError });

    const release = await route.acquireUploadSlot("a");
    await assert.rejects(route.acquireUploadSlot("b"), (error) => {
      // toErrorResponse only maps its own HttpError class to a status.
      assert.ok(error instanceof RouteHttpError);
      assert.equal(error.status, 503);
      assert.match(error.message, /稍后再试/);
      return true;
    });
    release();
    (await route.acquireUploadSlot("b"))();
  } finally {
    delete globalThis.__beeUploadGate;
  }
});

test("a freed upload slot goes to the longest waiter, and releasing twice frees one slot", async () => {
  const { createUploadGate } = loadStorage(4);
  const gate = createUploadGate({ limit: 2, waitMs: 5000, maxWaiting: 4 });
  const order = [];
  const releaseA = await gate.acquire("a");
  const releaseB = await gate.acquire("b");
  const third = track(gate.acquire("c"), "c", order);
  const fourth = track(gate.acquire("d"), "d", order);
  await nextTurn();
  assert.deepEqual(order, []);

  releaseA();
  releaseA();
  await nextTurn();
  assert.deepEqual(order, ["c"]);

  releaseB();
  await nextTurn();
  assert.deepEqual(order, ["c", "d"]);

  // Both slots are in use again; nothing was lost or double-counted.
  const fifth = track(gate.acquire("e"), "e", order);
  await nextTurn();
  assert.equal(fifth.granted, false);
  third.release();
  await nextTurn();
  assert.equal(fifth.granted, true);
  fourth.release();
  fifth.release();
});

test("one source holds at most half of the upload slots", async () => {
  const { createUploadGate } = loadStorage(4);
  const gate = createUploadGate({ limit: 4, waitMs: 5000, maxWaiting: 8 });
  const order = [];
  const releaseA1 = await gate.acquire("a");
  const releaseA2 = await gate.acquire("a");
  const thirdA = track(gate.acquire("a"), "a3", order);
  await nextTurn();
  assert.equal(thirdA.granted, false);

  // Other sources still get in while "a" is at its share.
  const releaseB1 = await gate.acquire("b");
  const releaseB2 = await gate.acquire("b");
  const firstC = track(gate.acquire("c"), "c1", order);
  await nextTurn();
  assert.deepEqual(order, []);

  // The freed slot skips the earlier waiter that is still over its own share.
  releaseB1();
  await nextTurn();
  assert.deepEqual(order, ["c1"]);

  releaseA1();
  await nextTurn();
  assert.deepEqual(order, ["c1", "a3"]);

  // A limit of 1 still lets a single source upload.
  const single = createUploadGate({ limit: 1, waitMs: 5000, maxWaiting: 1 });
  (await single.acquire("a"))();

  for (const release of [releaseA2, releaseB2, firstC.release, thirdA.release])
    release();
});

test("waiting uploads give up after the wait limit, and a full queue is refused at once", async () => {
  const { createUploadGate } = loadStorage(4);

  const full = createUploadGate({ limit: 1, waitMs: 5000, maxWaiting: 1 });
  const releaseFull = await full.acquire("a");
  const queued = track(full.acquire("b"));
  // Refused while the one allowed waiter is still in line, not after its wait.
  assert.equal(await full.acquire("c"), null);
  assert.equal(queued.granted, false);
  releaseFull();
  await nextTurn();
  assert.equal(queued.granted, true);
  queued.release();

  const gate = createUploadGate({ limit: 1, waitMs: 20, maxWaiting: 4 });
  const release = await gate.acquire("a");
  assert.equal(await gate.acquire("b"), null);

  // The waiter that gave up holds neither a place in the queue nor a slot:
  // the freed slot is available at once, and it is still the only one.
  release();
  const next = await gate.acquire("d");
  const later = track(gate.acquire("e"));
  await nextTurn();
  assert.equal(later.granted, false);
  next();
  await nextTurn();
  later.release?.();
});

test("agent uploads hold one slot per account while the body is read and always return it", async () => {
  const state = { held: 0, keys: [], user: { id: "agent-1", siteIds: null } };
  const tx = {
    attachment: { create: async ({ data }) => ({ id: "attachment", ...data }) },
  };
  const route = loadModule("src/app/api/agent/upload/route.ts", {
    "next/server": {
      NextResponse: {
        json: (body, init) => new Response(JSON.stringify(body), init),
      },
    },
    "@/lib/api": {
      toErrorResponse: (error) => new Response(null, { status: error.status }),
    },
    "@/lib/auth": {
      ...auth,
      requireUser: async () => {
        if (!state.user) throw new auth.HttpError(401, "signed out");
        return state.user;
      },
    },
    "@/lib/db": { prisma: { $transaction: async (run) => run(tx) } },
    "@/server/services/tenants": {
      assertTenantQuota: async () => {},
      assertSiteServing: async () => ({ id: "tenant" }),
    },
    "@/lib/storage": {
      acquireUploadSlot: async (key) => {
        state.keys.push(key);
        state.held += 1;
        return () => {
          state.held -= 1;
        };
      },
      deleteUpload: async () => {},
      readUploadForm: async (request) => {
        assert.equal(state.held, 1);
        return request.formData();
      },
      saveUpload: async (file) => {
        assert.equal(state.held, 1);
        return {
          storageKey: "site/2026/11/1.txt",
          filename: file.name,
          mimeType: file.type,
          size: file.size,
        };
      },
    },
  });
  const upload = (withFile) => {
    const form = new FormData();
    form.set("siteId", "site");
    if (withFile)
      form.set("file", new File(["x"], "note.txt", { type: "text/plain" }));
    return route.POST({ formData: async () => form });
  };

  assert.equal((await upload(true)).status, 200);
  assert.equal(state.held, 0);
  assert.equal((await upload(false)).status, 400);
  assert.equal(state.held, 0);
  assert.deepEqual(state.keys, ["agent:agent-1", "agent:agent-1"]);

  // A request that is not signed in never takes a slot.
  state.user = null;
  assert.equal((await upload(true)).status, 401);
  assert.equal(state.keys.length, 2);
});
