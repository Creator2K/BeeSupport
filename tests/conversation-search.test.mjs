import { test } from "node:test";
import assert from "node:assert/strict";
import { auth, loadModule } from "./load-module.mjs";

function searchFixture() {
  const wheres = [];
  const { listConversations } = loadModule(
    "src/server/services/conversation-queries.ts",
    {
      "../../lib/auth": auth,
      "../../lib/db": {
        prisma: {
          conversation: {
            count: async ({ where }) => {
              wheres.push(where);
              return 0;
            },
            findMany: async ({ where }) => {
              wheres.push(where);
              return [];
            },
          },
        },
      },
      "../presence": { filterOnlineVisitors: async () => new Set() },
      "../serialize": {
        conversationInclude: {},
        serializeConversation: (row) => row,
      },
    },
  );
  const agent = { id: "a1", role: "AGENT", siteIds: ["s1"], tenantId: "t1" };
  return { wheres, search: (query) => listConversations(agent, { query }) };
}

const keywordsOf = (where) =>
  where.OR.map(
    (condition) =>
      (
        condition.visitor?.email ??
        condition.visitor?.name ??
        condition.lastMessagePreview ??
        condition.subject
      ).contains,
  );

test("conversation search trims the keyword and never matches on more than 200 characters", async () => {
  const { wheres, search } = searchFixture();

  await search("  refund  ");
  // The count and the page use the same filter.
  assert.equal(wheres.length, 2);
  assert.deepEqual(wheres[0], wheres[1]);
  assert.deepEqual(wheres[0].siteId, { in: ["s1"] });
  assert.deepEqual(keywordsOf(wheres[0]), Array(4).fill("refund"));

  const long = "退款".repeat(5000);
  await search(long);
  assert.deepEqual(keywordsOf(wheres[2]), Array(4).fill(long.slice(0, 200)));

  // A cut inside a surrogate pair drops the half character instead of
  // leaving one that can never match.
  await search(`${"a".repeat(199)}\u{1F600}tail`);
  assert.deepEqual(keywordsOf(wheres[4]), Array(4).fill("a".repeat(199)));
  await search(`${"a".repeat(198)}\u{1F600}tail`);
  assert.deepEqual(
    keywordsOf(wheres[6]),
    Array(4).fill(`${"a".repeat(198)}\u{1F600}`),
  );

  // Blank keywords add no text filter at all.
  await search("   ");
  assert.equal(wheres[8].OR, undefined);
});
