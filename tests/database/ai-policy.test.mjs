import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  auth,
  entitlements,
  loadAiModule,
  loadModule,
} from "../load-module.mjs";
import { useTestDatabase } from "../../scripts/test-environment.mjs";

useTestDatabase();
const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();
const ai = loadAiModule(db);
const aiPolicy = loadModule("src/lib/ai-policy.ts");
const usage = loadModule("src/server/services/ai-usage.ts", {
  "../../lib/db": { prisma: db },
});
const policy = loadModule("src/server/services/ai-policy.ts", {
  "../../lib/ai": ai,
  "../../lib/ai-policy": aiPolicy,
  "../../lib/db": { prisma: db },
  "../../lib/entitlements": entitlements,
  "../../lib/audit": { recordAudit: async () => {} },
  "../../lib/auth": auth,
  "./ai-usage": usage,
});
const queue = loadModule("src/server/services/ai-job-queue.ts", {
  "../../lib/db": { prisma: db },
});

const baseInput = {
  enabledMode: "on",
  autoReply: "no_agent",
  assistantName: "商家助手",
  systemPrompt: "只根据知识库回答。",
  toolsMode: "on",
  mutationsMode: "off",
  monthlyRequestLimit: 100,
  monthlyTokenLimit: 20000,
  concurrencyLimit: 2,
  overLimitAction: "handoff",
};

async function tenantFixture() {
  const stamp = randomUUID();
  const tenant = await db.tenant.create({ data: { name: "AI policy test", slug: stamp } });
  const site = await db.site.create({
    data: { tenantId: tenant.id, name: "Main", slug: stamp },
  });
  return { tenant, site };
}

test("merchant policy writes enforce scope, site ownership and optimistic versions", async () => {
  const { tenant, site } = await tenantFixture();
  const foreign = await tenantFixture();
  const user = {
    id: "merchant-user",
    name: "Merchant admin",
    role: "MERCHANT_ADMIN",
    tenantId: tenant.id,
    siteIds: [site.id],
  };
  try {
    const created = await policy.saveMerchantAiPolicy(user, {
      ...baseInput,
      scope: "tenant",
      version: 0,
    });
    assert.equal(created.version, 1);
    const saved = await db.aiPolicy.findUniqueOrThrow({ where: { tenantId: tenant.id } });
    assert.equal(saved.autoReply, "no_agent");
    assert.equal(saved.allowMutations, false);
    assert.equal(saved.monthlyRequestLimit, 100);

    const updated = await policy.saveMerchantAiPolicy(user, {
      ...baseInput,
      scope: "tenant",
      version: 1,
      autoReply: "always",
    });
    assert.equal(updated.version, 2);
    await assert.rejects(
      policy.saveMerchantAiPolicy(user, {
        ...baseInput,
        scope: "tenant",
        version: 1,
      }),
      { status: 409 },
    );

    const sitePolicy = await policy.saveMerchantAiPolicy(user, {
      ...baseInput,
      scope: "site",
      siteId: site.id,
      version: 0,
      autoReply: "inherit",
      overLimitAction: "inherit",
      concurrencyLimit: null,
    });
    assert.equal(sitePolicy.version, 1);
    const savedSite = await db.aiSitePolicy.findUniqueOrThrow({ where: { siteId: site.id } });
    assert.equal(savedSite.tenantId, tenant.id);
    assert.equal(savedSite.autoReply, null);
    assert.equal(savedSite.overLimitAction, null);

    await assert.rejects(
      policy.saveMerchantAiPolicy(
        { ...user, siteIds: [] },
        {
          ...baseInput,
          scope: "site",
          siteId: foreign.site.id,
          version: 0,
        },
      ),
      { status: 403 },
    );
    await assert.rejects(
      policy.saveMerchantAiPolicy(
        { ...user, role: "ADMIN" },
        { ...baseInput, scope: "tenant", version: 2 },
      ),
      { status: 403 },
    );
  } finally {
    await db.site.deleteMany({ where: { tenantId: { in: [tenant.id, foreign.tenant.id] } } });
    await db.tenant.deleteMany({ where: { id: { in: [tenant.id, foreign.tenant.id] } } });
  }
});

test("monthly quota checks use merchant or site scope and usage is aggregated", async () => {
  const { tenant, site } = await tenantFixture();
  const other = await db.site.create({
    data: { tenantId: tenant.id, name: "Other", slug: randomUUID() },
  });
  const day = usage.shanghaiDay();
  try {
    await db.aiUsageDaily.createMany({
      data: [
        { tenantId: tenant.id, siteId: site.id, day, requests: 1, promptTokens: 300, completionTokens: 100 },
        { tenantId: tenant.id, siteId: other.id, day, requests: 1, promptTokens: 200, completionTokens: 100 },
      ],
    });
    const policyValue = {
      enabled: true,
      config: { ...ai.defaultAiConfig(), enabled: true, maxTokens: 600 },
      autoReply: "always",
      allowMutations: true,
      monthlyRequestLimit: 2,
      monthlyTokenLimit: 5000,
      requestLimitScope: "tenant",
      tokenLimitScope: "tenant",
      concurrencyLimit: 2,
      overLimitAction: "skip",
    };
    assert.deepEqual(await usage.checkAiQuota(tenant.id, site.id, policyValue), {
      ok: false,
      reason: "request_limit",
      action: "skip",
    });
    assert.deepEqual(
      await usage.checkAiQuota(tenant.id, site.id, {
        ...policyValue,
        monthlyRequestLimit: 2,
        requestLimitScope: "site",
      }),
      { ok: true },
    );
    assert.deepEqual(
      await usage.checkAiQuota(tenant.id, site.id, {
        ...policyValue,
        monthlyRequestLimit: null,
        monthlyTokenLimit: 500,
        tokenLimitScope: "site",
      }),
      { ok: false, reason: "token_limit", action: "skip" },
    );

    await usage.recordAiUsage({
      tenantId: tenant.id,
      siteId: site.id,
      requests: 1,
      promptTokens: 11,
      completionTokens: 7,
    });
    const summary = await usage.getAiUsageSummary(tenant.id);
    assert.equal(summary.totals.requests, 3);
    assert.equal(summary.totals.totalTokens, 718);
    assert.equal(summary.sites.find((item) => item.siteId === site.id)?.requests, 2);
  } finally {
    await db.site.deleteMany({ where: { tenantId: tenant.id } });
    await db.tenant.delete({ where: { id: tenant.id } });
  }
});

test("claiming serializes a merchant concurrency limit without blocking other merchants", async () => {
  const first = await tenantFixture();
  const second = await tenantFixture();
  const stamp = randomUUID();
  const visitor = await db.visitor.create({
    data: { siteId: first.site.id, email: `${stamp}@test.local`, localKey: stamp },
  });
  const conversation = await db.conversation.create({
    data: {
      siteId: first.site.id,
      visitorId: visitor.id,
      messages: { create: { sender: "VISITOR", body: "hello" } },
    },
    include: { messages: true },
  });
  const knowledge = await db.aiKnowledge.create({
    data: { tenantId: first.tenant.id, title: "Article", content: "Body" },
  });
  const secondVisitor = await db.visitor.create({
    data: { siteId: second.site.id, email: `b-${stamp}@test.local`, localKey: `b-${stamp}` },
  });
  const secondConversation = await db.conversation.create({
    data: {
      siteId: second.site.id,
      visitorId: secondVisitor.id,
      messages: { create: { sender: "VISITOR", body: "hello" } },
    },
    include: { messages: true },
  });
  try {
    await db.aiPolicy.createMany({
      data: [
        { tenantId: first.tenant.id, concurrencyLimit: 1 },
        { tenantId: second.tenant.id, concurrencyLimit: 1 },
      ],
    });
    await db.aiJob.createMany({
      data: [
        {
          id: `reply:${conversation.id}`,
          tenantId: first.tenant.id,
          kind: "AUTO_REPLY",
          conversationId: conversation.id,
          messageId: conversation.messages[0].id,
        },
        {
          id: `index:${knowledge.id}`,
          tenantId: first.tenant.id,
          kind: "KNOWLEDGE_INDEX",
          knowledgeId: knowledge.id,
        },
        {
          id: `reply:${secondConversation.id}`,
          tenantId: second.tenant.id,
          kind: "AUTO_REPLY",
          conversationId: secondConversation.id,
          messageId: secondConversation.messages[0].id,
        },
      ],
    });
    const firstClaim = await queue.claimAiJob();
    const secondClaim = await queue.claimAiJob();
    assert.ok(firstClaim);
    assert.ok(secondClaim);
    assert.notEqual(firstClaim.tenantId, secondClaim.tenantId);
    assert.equal(await queue.claimAiJob(), null);
  } finally {
    await db.aiKnowledge.deleteMany({
      where: { tenantId: { in: [first.tenant.id, second.tenant.id] } },
    });
    await db.site.deleteMany({ where: { tenantId: { in: [first.tenant.id, second.tenant.id] } } });
    await db.tenant.deleteMany({ where: { id: { in: [first.tenant.id, second.tenant.id] } } });
  }
});

test.after(async () => {
  await db.$disconnect();
});
