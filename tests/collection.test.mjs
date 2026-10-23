import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { loadModule } from "./load-module.mjs";
const policy = loadModule("src/lib/collection.ts", { zod: { z } });
test("collection settings are opt-in, bounded and reject executable or credential-bearing image URLs", () => {
  assert.equal(policy.DEFAULT_COLLECTION.enabled, false);
  assert.deepEqual(
    policy.readCollection(null).settings,
    policy.DEFAULT_COLLECTION,
  );
  const base = {
    ...policy.DEFAULT_COLLECTION,
    enabled: true,
    instructions: "人工核对",
  };
  for (const url of [
    "https://example.com/qr.png",
    "http://192.168.1.168/qr.png",
    "",
  ])
    assert.equal(
      policy.collectionSchema.safeParse({ ...base, qrCodeUrl: url }).success,
      true,
    );
  for (const update of [
    { qrCodeUrl: "javascript:alert(1)" },
    { qrCodeUrl: "data:image/png;base64,abc" },
    { qrCodeUrl: "https://user:pass@example.com/qr" },
    { qrCodeUrl: "/local.png" },
    { instructions: "x".repeat(2001) },
    { html: "<script>" },
    { instructions: "", contact: "" },
  ])
    assert.equal(
      policy.collectionSchema.safeParse({ ...base, ...update }).success,
      false,
    );
});
test("payment reports require explicit acknowledgement, bounded text and an integer version", () => {
  const base = {
    note: " 微信付款，流水末四位 1234 ",
    acknowledged: true,
    expectedVersion: 0,
  };
  assert.equal(policy.paymentReportSchema.parse(base).note, base.note.trim());
  for (const update of [
    { acknowledged: false },
    { note: "  " },
    { note: "x".repeat(501) },
    { expectedVersion: -1 },
    { expectedVersion: 0.5 },
    { status: "CONFIRMED" },
    { priceCents: 1 },
  ])
    assert.equal(
      policy.paymentReportSchema.safeParse({ ...base, ...update }).success,
      false,
    );
});

test("notice reads invalidate both the rendered admin layout and the public alias", async () => {
  const paths = [],
    updates = [];
  const action = loadModule("src/server/actions/account-notices.ts", {
    "next/cache": { revalidatePath: (...args) => paths.push(args) },
    zod: { z },
    "@/lib/auth": {
      requireAdmin: async () => ({ id: "user-a", tenantId: "tenant-a" }),
    },
    "@/lib/db": {
      prisma: {
        accountNotice: {
          updateMany: async (args) => {
            updates.push(args);
            return { count: 1 };
          },
        },
      },
    },
    "@/lib/app-paths": { ADMIN_PATH: "/console-test" },
    "@/server/services/account-notices": {
      visibleNoticeWhere: async (user) => ({
        userId: user.id,
        tenantId: user.tenantId,
      }),
    },
    "./result": {
      toActionResult: (error) => {
        throw error;
      },
    },
  });
  assert.equal((await action.markNoticesReadAction("notice-a")).ok, true);
  assert.deepEqual(paths, [
    ["/admin", "layout"],
    ["/console-test", "layout"],
  ]);
  assert.deepEqual(updates[0].where, {
    userId: "user-a",
    tenantId: "tenant-a",
    id: "notice-a",
    readAt: null,
  });
});
