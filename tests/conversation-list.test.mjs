import { test } from "node:test";
import assert from "node:assert/strict";

import { loadModule } from "./load-module.mjs";

const { filterConversations } = loadModule(
  "src/components/agent/conversation-list-filter.ts",
);

const conversations = [
  {
    id: "pending",
    status: "PENDING",
    siteId: "site-1",
    assignedAgent: null,
    unreadForAgent: 2,
    visitor: { email: "queue@example.test", name: "Queue Visitor" },
    lastMessagePreview: "Need help with refund",
    subject: "Refund",
  },
  {
    id: "mine",
    status: "OPEN",
    siteId: "site-2",
    assignedAgent: { id: "me", name: "Me" },
    unreadForAgent: 0,
    visitor: { email: "mine@example.test", name: "My Visitor" },
    lastMessagePreview: "Order status",
    subject: "Order",
  },
  {
    id: "closed",
    status: "CLOSED",
    siteId: "site-1",
    assignedAgent: { id: "me", name: "Me" },
    unreadForAgent: 1,
    visitor: { email: "closed@example.test", name: "Closed Visitor" },
    lastMessagePreview: "Thanks",
    subject: "Done",
  },
];

const filters = {
  tab: "queue",
  siteId: "all",
  query: "",
  unreadOnly: false,
};
const ids = (value) => value.map((conversation) => conversation.id);

test("conversation filters preserve tab, site, unread and keyword behavior", () => {
  assert.deepEqual(ids(filterConversations(conversations, filters, "me")), [
    "pending",
  ]);
  assert.deepEqual(
    ids(filterConversations(conversations, { ...filters, tab: "mine" }, "me")),
    ["mine"],
  );
  assert.deepEqual(
    ids(filterConversations(conversations, { ...filters, tab: "all" }, "me")),
    ["pending", "mine"],
  );
  assert.deepEqual(
    ids(filterConversations(conversations, { ...filters, tab: "closed" }, "me")),
    ["closed"],
  );
  assert.deepEqual(
    ids(
      filterConversations(
        conversations,
        { ...filters, tab: "all", siteId: "site-2" },
        "me",
      ),
    ),
    ["mine"],
  );
  assert.deepEqual(
    ids(
      filterConversations(
        conversations,
        { ...filters, tab: "all", unreadOnly: true },
        "me",
      ),
    ),
    ["pending"],
  );
  assert.deepEqual(
    ids(
      filterConversations(
        conversations,
        { ...filters, tab: "all", query: "ORDER STATUS" },
        "me",
      ),
    ),
    ["mine"],
  );
});