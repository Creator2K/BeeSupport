import { test } from "node:test";
import assert from "node:assert/strict";
import { cannedPolicy as policy, cannedService } from "./canned-fixtures.mjs";
const manager = {
  role: "MERCHANT_ADMIN",
  tenantId: "own",
  id: "manager",
  siteIds: null,
};

test("canned replies trim fields, normalize shortcut case and reject scope injection or excessive content", () => {
  const data = policy.cannedInputSchema.parse({
    title: " 标题 ",
    content: " 内容 ",
    shortcut: " PRICE ",
    category: " 售后 ",
  });
  assert.equal(data.title, "标题");
  assert.equal(data.content, "内容");
  assert.equal(data.shortcut, "price");
  assert.equal(data.category, "售后");
  assert.equal(data.shared, true);
  for (const extra of [
    { content: "x".repeat(2001) },
    { category: "x".repeat(31) },
    { shortcut: "a b" },
    { title: " " },
    { ownerId: "someone" },
    { tenantId: "foreign" },
  ])
    assert.equal(
      policy.cannedInputSchema.safeParse({
        title: "标题",
        content: "内容",
        ...extra,
      }).success,
      false,
    );
});
test("reply insertion replaces a standalone slash command, preserves prose and enforces the draft limit", () => {
  assert.equal(policy.appendCannedText("/", "您好"), "您好");
  assert.equal(policy.appendCannedText(" /price ", "价格说明"), "价格说明");
  assert.equal(
    policy.appendCannedText("原草稿 /price", "价格说明"),
    "原草稿 /price\n价格说明",
  );
  assert.equal(policy.appendCannedText("原草稿", "您好"), "原草稿\n您好");
  assert.equal(policy.appendCannedText("", "您好"), "您好");
  assert.throws(() => policy.appendCannedText("x".repeat(4999), "xx"), /5000/);
  assert.equal(policy.cannedKeyword(" /PRICE "), "PRICE");
});
test("canned management denies ordinary agents before accessing persistence", async () => {
  const service = cannedService(
    new Proxy(
      {},
      {
        get() {
          throw Error("Unexpected database access");
        },
      },
    ),
  );
  const actor = { ...manager, role: "AGENT" };
  await assert.rejects(service.listManagedCanned(actor), { status: 403 });
  await assert.rejects(service.saveCannedReply(actor, {}), { status: 403 });
  await assert.rejects(service.deleteCannedReply(actor, "id"), { status: 403 });
});
test("agent listing includes shared-or-owned checks and derives the tenant from an authorized site", async () => {
  const queries = [];
  const service = cannedService({
    site: { findFirst: async () => ({ tenantId: "own" }) },
    cannedResponse: {
      findMany: async (args) => {
        queries.push(args);
        return [];
      },
    },
  });
  await service.listCannedForAgent(manager, {
    siteId: "site",
    query: "/price",
  });
  const where = JSON.stringify(queries[0].where);
  assert.ok(where.includes('"tenantId":"own"'));
  assert.ok(where.includes('"shared":true'));
  assert.ok(where.includes('"ownerId":"manager"'));
  assert.ok(where.includes('"siteId":null'));
  assert.ok(where.includes('"siteId":"site"'));
  assert.ok(where.includes('"contains":"price"'));
  assert.equal(queries[0].take, 51);
});
test("site authorization and reply visibility are checked before a usage counter can change", async () => {
  let writes = 0;
  const service = cannedService({
    site: { findFirst: async () => null },
    $transaction: async () => {
      writes++;
    },
  });
  await assert.rejects(service.recordCannedUse(manager, "hidden", "foreign"), {
    status: 403,
  });
  assert.equal(writes, 0);
  const hidden = cannedService({
    site: { findFirst: async () => ({ tenantId: "own" }) },
    $transaction: async (callback) =>
      callback({
        cannedResponse: {
          findFirst: async () => null,
          updateMany: async () => {
            writes++;
          },
        },
      }),
  });
  await assert.rejects(hidden.recordCannedUse(manager, "hidden", "site"), {
    status: 404,
  });
  assert.equal(writes, 0);
});
test("a reply made private between lookup and use is rejected rather than returning its content", async () => {
  const service = cannedService({
    site: { findFirst: async () => ({ tenantId: "own" }) },
    $transaction: async (callback) =>
      callback({
        cannedResponse: {
          findFirst: async () => ({ id: "reply", content: "private now" }),
          updateMany: async () => ({ count: 0 }),
        },
      }),
  });
  await assert.rejects(service.recordCannedUse(manager, "reply", "site"), {
    status: 404,
  });
});
