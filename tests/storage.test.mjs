import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadModule, auth } from "./load-module.mjs";

test("uploads enforce file limits and stream authenticated content without loading it twice", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "beesupport-storage-test-"));
  try {
    const storage = loadModule("src/lib/storage.ts", {
      "./auth": auth,
      "./env": { env: { UPLOAD_DIR: root, UPLOAD_MAX_BYTES: 64 } },
    });
    const upload = await storage.saveUpload(
      new File(["hello"], "note.txt", { type: "text/plain" }),
      { siteId: "s1", uploader: "VISITOR", uploaderId: "v1" },
    );
    assert.equal(upload.size, 5);
    assert.match(upload.storageKey, /^s1\/\d{4}\/\d{2}\/[\da-f-]+\.txt$/);
    const file = await storage.streamUpload(upload.storageKey);
    assert.equal(file.size, 5);
    assert.equal(await new Response(file.body).text(), "hello");
    await assert.rejects(
      storage.saveUpload(
        new File(["x".repeat(65)], "too-big.txt", { type: "text/plain" }),
        { siteId: "s1", uploader: "VISITOR" },
      ),
      { status: 413 },
    );
    assert.throws(() => storage.resolveStoragePath("../../private.txt"), {
      status: 400,
    });
    await storage.deleteUpload(upload.storageKey);
    await assert.rejects(storage.streamUpload(upload.storageKey), {
      status: 404,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy Windows storage keys resolve portably and reject traversal and absolute paths on both platforms", () => {
  for (const [platform, root] of [
    [path.posix, "/uploads"],
    [path.win32, "C:\\uploads"],
  ]) {
    const storage = loadModule("src/lib/storage.ts", {
      "node:path": platform,
      "./auth": auth,
      "./env": { env: { UPLOAD_DIR: root, UPLOAD_MAX_BYTES: 64 } },
    });
    for (const key of [
      "s1/2026/10/file.txt",
      "s1\\2026\\10/file.txt",
      "s1\\2026\\10\\file.txt",
    ]) {
      assert.equal(
        storage.resolveStoragePath(key),
        platform.join(root, "s1", "2026", "10", "file.txt"),
      );
    }
    for (const key of [
      "", ".", "..", "../private", "..\\private",
      "s1/../../private", "s1\\..\\..\\private", "/private",
      "C:\\private", "C:private", "\\\\server\\share\\file",
      "s1/file:stream", "s1/\0file",
    ]) {
      assert.throws(() => storage.resolveStoragePath(key), { status: 400 });
    }
  }
});

test("migrated Windows attachments can be read, streamed and removed through their original database keys", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "beesupport-migrated-upload-"));
  try {
    const storage = loadModule("src/lib/storage.ts", {
      "./auth": auth,
      "./env": { env: { UPLOAD_DIR: root, UPLOAD_MAX_BYTES: 64 } },
    });
    const upload = await storage.saveUpload(
      new File(["legacy content"], "old.txt", { type: "text/plain" }),
      { siteId: "s1", uploader: "VISITOR" },
    );
    const parts = upload.storageKey.split("/");
    const legacyKey = `${parts.slice(0, -1).join("\\")}/${parts.at(-1)}`;
    assert.equal((await storage.readUpload(legacyKey)).toString(), "legacy content");
    assert.equal(
      await new Response((await storage.streamUpload(legacyKey)).body).text(),
      "legacy content",
    );
    await storage.deleteUpload(legacyKey);
    await assert.rejects(storage.readUpload(upload.storageKey), { status: 404 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("multipart limits apply to chunked uploads as well as Content-Length", async () => {
  const storage = loadModule("src/lib/storage.ts", {
    "./auth": auth,
    "./env": { env: { UPLOAD_DIR: tmpdir(), UPLOAD_MAX_BYTES: 64 } },
  });
  const form = new FormData();
  form.set("file", new File(["hello"], "ok.txt", { type: "text/plain" }));
  const valid = await storage.readUploadForm(
    new Request("http://test/upload", { method: "POST", body: form }),
  );
  assert.equal(await valid.get("file").text(), "hello");
  const large = new FormData();
  large.set(
    "file",
    new File(["x".repeat(1024 * 1024 + 100)], "large.txt", {
      type: "text/plain",
    }),
  );
  await assert.rejects(
    storage.readUploadForm(
      new Request("http://test/upload", { method: "POST", body: large }),
    ),
    { status: 413 },
  );
  await assert.rejects(
    storage.readUploadForm(
      new Request("http://test/upload", { method: "POST", body: "invalid" }),
    ),
    { status: 400 },
  );
});

test("file downloads require the visitor bearer token and reject internal-note attachments", async () => {
  let currentUser = null;
  const attachment = {
    id: "f1",
    siteId: "s1",
    uploader: "VISITOR",
    uploaderId: "v1",
    filename: "file.txt",
    mimeType: "text/plain",
    storageKey: "file",
    message: { type: "TEXT", conversation: { visitorId: "v1" } },
  };
  class NextResponse extends Response {
    static json(data, init) {
      return new NextResponse(JSON.stringify(data), init);
    }
  }
  const route = loadModule("src/app/api/files/[id]/route.ts", {
    "next/server": { NextResponse },
    "@/lib/api": {
      toErrorResponse: (error) =>
        NextResponse.json(
          { error: error.message },
          { status: error.status ?? 500 },
        ),
    },
    "@/lib/auth": { ...auth, getCurrentUser: async () => currentUser },
    "@/lib/db": {
      prisma: { attachment: { findUnique: async () => attachment } },
    },
    "@/lib/storage": {
      streamUpload: async () => ({ size: 5, body: new Response("hello").body }),
    },
    "@/server/services/risk": {
      verifyVisitorRequest: async (headers) =>
        headers.get("authorization") === "Bearer visitor-token"
          ? { visitorId: "v1", siteId: "s1" }
          : null,
    },
  });
  const context = { params: Promise.resolve({ id: "f1" }) };
  assert.equal(
    (await route.GET(new Request("http://test/file"), context)).status,
    403,
  );
  const request = () =>
    new Request("http://test/file", {
      headers: { authorization: "Bearer visitor-token" },
    });
  const allowed = await route.GET(request(), context);
  assert.equal(allowed.status, 200);
  assert.equal(await allowed.text(), "hello");
  assert.equal(allowed.headers.get("cache-control"), "private, no-store");
  currentUser = { siteIds: ["different-site"] };
  assert.equal((await route.GET(request(), context)).status, 200);
  attachment.message.type = "NOTE";
  assert.equal((await route.GET(request(), context)).status, 403);
});
