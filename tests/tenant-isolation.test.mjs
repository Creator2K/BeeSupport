import { test } from "node:test";
import assert from "node:assert/strict";

import { loadModule, auth } from "./load-module.mjs";

const ownTenant = "tenant-own";
const foreignTenant = "tenant-foreign";
const records = {
  site: {
    "site-own": { tenantId: ownTenant },
    "site-foreign": { tenantId: foreignTenant },
  },
  user: {
    "user-own": { tenantId: ownTenant, role: "AGENT" },
    "user-foreign": { tenantId: foreignTenant, role: "AGENT" },
    "admin-user": { tenantId: "legacy", role: "ADMIN" },
  },
  visitor: {
    "visitor-own": { tenantId: ownTenant, siteId: "site-own" },
    "visitor-foreign": { tenantId: foreignTenant, siteId: "site-foreign" },
    "visitor-other-site": { tenantId: ownTenant, siteId: "site-own-2" },
  },
  conversation: {
    "conversation-own": { tenantId: ownTenant, siteId: "site-own" },
    "conversation-foreign": { tenantId: foreignTenant, siteId: "site-foreign" },
  },
  message: {
    "message-own": { tenantId: ownTenant, siteId: "site-own" },
    "message-foreign": { tenantId: foreignTenant, siteId: "site-foreign" },
  },
  attachment: {
    "attachment-own": { tenantId: ownTenant, siteId: "site-own" },
    "attachment-foreign": { tenantId: foreignTenant, siteId: "site-foreign" },
  },
  aiKnowledge: {
    "knowledge-own": { tenantId: ownTenant },
    "knowledge-foreign": { tenantId: foreignTenant },
  },
  riskRule: {
    "rule-own": { tenantId: ownTenant },
    "rule-foreign": { tenantId: foreignTenant },
  },
};

const relationMatch = (model, id, tenantId, siteId) => {
  const record = records[model]?.[id];
  if (!record || record.tenantId !== tenantId) return null;
  if (siteId && record.siteId !== siteId) return null;
  return record;
};

const prisma = {
  $extends(extension) {
    return { $allOperations: extension.query.$allOperations };
  },
  site: {
    findFirst: async ({ where }) =>
      relationMatch("site", where.id, where.tenantId)
        ? { id: where.id }
        : null,
  },
  user: {
    findFirst: async ({ where }) => {
      const record = records.user[where.id];
      if (!record || record.tenantId !== where.tenantId) return null;
      if (where.role?.not === "ADMIN" && record.role === "ADMIN") return null;
      return { id: where.id };
    },
  },
  visitor: {
    findFirst: async ({ where }) =>
      relationMatch("visitor", where.id, where.site.tenantId, where.siteId),
  },
  conversation: {
    findFirst: async ({ where }) =>
      relationMatch(
        "conversation",
        where.id,
        where.site.tenantId,
        where.siteId,
      ),
  },
  message: {
    findFirst: async ({ where }) => {
      const record = relationMatch(
        "message",
        where.id,
        where.conversation.site.tenantId,
        where.conversation.siteId,
      );
      return record ? { conversation: { siteId: record.siteId } } : null;
    },
  },
  attachment: {
    findFirst: async ({ where }) =>
      relationMatch("attachment", where.id, where.site.tenantId, where.siteId),
  },
  aiKnowledge: {
    findFirst: async ({ where }) =>
      relationMatch("aiKnowledge", where.id, where.tenantId),
  },
  riskRule: {
    findFirst: async ({ where }) =>
      relationMatch("riskRule", where.id, where.tenantId),
  },
};

const { tenantDb } = loadModule("src/lib/tenant-db.ts", {
  "./auth": { ...auth, requireAdmin: async () => merchant },
  "./db": { prisma },
});
const merchant = {
  id: "merchant-own",
  role: "MERCHANT_ADMIN",
  tenantId: ownTenant,
  siteIds: ["site-own", "site-own-2"],
};
const db = tenantDb(merchant);
const run = (model, operation, data) =>
  db.$allOperations({
    model,
    operation,
    args: { data },
    query: async (args) => args,
  });
const rejected = (promise) =>
  assert.rejects(promise, (error) => error.status === 403);

test("message writes validate the conversation tenant", async () => {
  await rejected(run("Message", "create", { conversationId: "conversation-foreign" }));
  await rejected(
    run("Message", "create", {
      conversationId: "conversation-own",
      authorId: "user-foreign",
    }),
  );
  const result = await run("Message", "create", {
    conversationId: "conversation-own",
    authorId: "user-own",
  });
  assert.equal(result.data.conversationId, "conversation-own");
});

test("conversation writes keep visitor and assignee inside the tenant and site", async () => {
  await rejected(
    run("Conversation", "create", {
      siteId: "site-own",
      visitorId: "visitor-foreign",
    }),
  );
  await rejected(
    run("Conversation", "create", {
      siteId: "site-own",
      visitorId: "visitor-other-site",
    }),
  );
  await rejected(
    run("Conversation", "create", {
      siteId: "site-own",
      visitorId: "visitor-own",
      assignedAgentId: "user-foreign",
    }),
  );
  const result = await run("Conversation", "create", {
    siteId: "site-own",
    visitorId: "visitor-own",
    assignedAgentId: "user-own",
  });
  assert.equal(result.data.visitorId, "visitor-own");
});

test("attachment writes validate message, site, and uploader ownership", async () => {
  await rejected(
    run("Attachment", "create", {
      siteId: "site-own",
      messageId: "message-foreign",
      uploader: "AGENT",
      uploaderId: "user-own",
    }),
  );
  await rejected(
    run("Attachment", "create", {
      siteId: "site-own",
      messageId: "message-own",
      uploader: "VISITOR",
      uploaderId: "visitor-foreign",
    }),
  );
  const result = await run("Attachment", "create", {
    siteId: "site-own",
    messageId: "message-own",
    uploader: "VISITOR",
    uploaderId: "visitor-own",
  });
  assert.equal(result.data.messageId, "message-own");
});

test("knowledge, risk, batch, upsert, and nested relation writes remain isolated", async () => {
  await rejected(
    run("AiKnowledgeChunk", "create", { knowledgeId: "knowledge-foreign" }),
  );
  await rejected(
    run("RiskEvent", "create", {
      siteId: "site-own",
      visitorId: "visitor-foreign",
      ip: "127.0.0.1",
      context: "message",
    }),
  );
  await rejected(run("RiskEvent", "create", { ruleId: "rule-foreign" }));
  await rejected(
    run("Visitor", "update", { pendingImageId: "attachment-foreign" }),
  );
  const knowledge = await run("AiKnowledgeChunk", "create", {
    knowledgeId: "knowledge-own",
  });
  assert.equal(knowledge.data.knowledgeId, "knowledge-own");
  await rejected(
    run("Message", "createMany", [
      { conversationId: "conversation-own" },
      { conversationId: "conversation-foreign" },
    ]),
  );

  let queryCalled = false;
  await rejected(
    db.$allOperations({
      model: "Message",
      operation: "create",
      args: { data: { conversation: { connect: { id: "conversation-own" } } } },
      query: async (args) => {
        queryCalled = true;
        return args;
      },
    }),
  );
  assert.equal(queryCalled, false);

  const upsert = await db.$allOperations({
    model: "Message",
    operation: "upsert",
    args: {
      where: { conversationId_clientId: { conversationId: "conversation-own", clientId: "c1" } },
      create: { conversationId: "conversation-own", clientId: "c1" },
      update: { conversationId: "conversation-own" },
    },
    query: async (args) => args,
  });
  assert.equal(upsert.update.conversationId, "conversation-own");
});

test("query scoping and tenant id injection still work", async () => {
  const scoped = await db.$allOperations({
    model: "Message",
    operation: "findMany",
    args: { where: { id: "message-own" } },
    query: async (args) => args,
  });
  assert.deepEqual(scoped.where.AND[1], {
    conversation: { site: { tenantId: ownTenant } },
  });

  const created = await run("User", "create", {
    email: "agent@example.test",
    name: "Agent",
    passwordHash: "hash",
  });
  assert.equal(created.data.tenantId, ownTenant);
  await rejected(run("User", "create", { tenantId: foreignTenant }));
});
