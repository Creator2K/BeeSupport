import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  auth,
  loadConversationService,
  loadModule,
  tenants,
} from "../load-module.mjs";
import { useTestDatabase } from "../../scripts/test-environment.mjs";

useTestDatabase();
const { PrismaClient } = await import("@prisma/client");

test("PostgreSQL row locks preserve concurrent preference patches", async () => {
  const prisma = new PrismaClient();
  const user = await prisma.user.create({
    data: {
      email: `prefs-${randomUUID()}@test.local`,
      name: "Test",
      passwordHash: "unused",
    },
  });
  try {
    const actions = loadModule("src/server/actions/preferences.ts", {
      "@/lib/auth": { requireUser: async () => user },
      "@/lib/db": { prisma },
      "@/lib/preferences": loadModule("src/lib/preferences.ts"),
      "./result": {
        toActionResult: (error) => ({ ok: false, error: error.message }),
      },
    });
    for (let index = 0; index < 8; index += 1) {
      await prisma.user.update({
        where: { id: user.id },
        data: { preferences: {} },
      });
      const results = await Promise.all([
        actions.savePreferencesAction({ soundVolume: 0.2 }),
        actions.savePreferencesAction({ desktopNotify: false }),
        actions.savePreferencesAction({ preferredModel: "test-model" }),
      ]);
      assert.ok(results.every((r) => r.ok));
      const stored = (await prisma.user.findUnique({ where: { id: user.id } }))
        .preferences;
      assert.equal(stored.soundVolume, 0.2);
      assert.equal(stored.desktopNotify, false);
      assert.equal(stored.preferredModel, "test-model");
    }
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});

test("transactional outbox rolls back with a claim, retries independently, and recovers expired leases", async () => {
  const prisma = new PrismaClient();
  const stamp = randomUUID();
  let site, user;
  const prefs = loadModule("src/server/services/notification-outbox.ts", {
    "../../lib/db": { prisma },
  });
  const notifications = loadModule("src/server/services/notifications.ts", {
    "../../lib/env": { env: { APP_URL: "http://test.local" } },
    "./notification-outbox": prefs,
  });
  const buildService = (notify = notifications) =>
    loadConversationService({
      "./tenants": tenants,
      "../../lib/auth": auth,
      "../../lib/db": { prisma },
      "../../lib/realtime/public": {},
      "../../lib/widget": {},
      "../presence": {},
      "../transactions": loadModule("src/server/transactions.ts"),
      "../serialize": loadModule("src/server/serialize.ts"),
      "./broadcast": {
        broadcastConversation: async () => null,
        broadcastMessage: async () => {},
      },
      "./messages": {},
      "./notifications": notify,
      "./visitors": {},
      "./follow-up-rules": {},
    });
  let shouldFail = true;
  const deliveries = [];
  const worker = loadModule("src/server/notification-worker.ts", {
    "./services/account-mail": {
      deliverAccountMail: async () => {
        throw new Error("Unexpected account mail in outbox test");
      },
    },
    "./services/subscription-reminders": {
      deliverExpiryMail: async () => {
        throw new Error("Unexpected expiry reminder in outbox test");
      },
    },
    "../lib/db": { prisma },
    "../lib/mail": { sendMail: async () => ({ ok: true }) },
    "../lib/webhooks": {
      sendWebhookDelivery: async (id, _payload, deliveryId) => {
        deliveries.push({ id, deliveryId });
        return shouldFail
          ? { ok: false, error: "temporary", retryable: true }
          : { ok: true };
      },
    },
  });
  try {
    user = await prisma.user.create({
      data: {
        email: `${stamp}@test.local`,
        name: "Agent",
        passwordHash: "unused",
      },
    });
    site = await prisma.site.create({
      data: {
        name: "Outbox",
        slug: stamp,
        visitors: { create: { email: "visitor@test.local", localKey: stamp } },
      },
      include: { visitors: true },
    });
    const conversation = await prisma.conversation.create({
      data: { siteId: site.id, visitorId: site.visitors[0].id },
    });
    const hook = await prisma.webhookEndpoint.create({
      data: {
        name: "Queue test",
        siteId: site.id,
        type: "GENERIC",
        url: "http://unused.invalid",
        events: ["conversation.assigned"],
      },
    });
    const agent = { ...user, siteIds: [site.id] };
    const failing = buildService({
      ...notifications,
      notifyConversationAssigned: async (input, tx) => {
        await notifications.notifyConversationAssigned(input, tx);
        throw new Error("rollback after enqueue");
      },
    });
    await assert.rejects(
      failing.claimConversation(agent, conversation.id),
      /rollback after enqueue/,
    );
    assert.equal(
      (await prisma.conversation.findUnique({ where: { id: conversation.id } }))
        .status,
      "PENDING",
    );
    assert.equal(await prisma.notificationJob.count(), 0);
    const service = buildService();
    await service.claimConversation(agent, conversation.id);
    await service.claimConversation(agent, conversation.id);
    assert.equal(
      await prisma.notificationJob.count(),
      1,
      "idempotent claims must not duplicate delivery jobs",
    );
    assert.deepEqual(await service.conversationCounts(agent, site.id), {
      pending: 0,
      open: 1,
      unread: 0,
      mine: 1,
    });
    assert.deepEqual(
      await service.conversationCounts({ ...agent, siteIds: [] }),
      { pending: 0, open: 0, unread: 0, mine: 0 },
    );

    const claims = await Promise.all([
      worker.claimNotification(),
      worker.claimNotification(),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    const first = claims.find(Boolean);
    await worker.deliverNotification(first);
    const pending = await prisma.notificationJob.findUnique({
      where: { id: first.id },
    });
    assert.equal(pending.status, "PENDING");
    assert.equal(
      await worker.claimNotification(),
      null,
      "retry backoff survives between worker runs",
    );
    await prisma.notificationJob.update({
      where: { id: first.id },
      data: { availableAt: new Date(0) },
    });
    const interrupted = await worker.claimNotification();
    await prisma.notificationJob.update({
      where: { id: interrupted.id },
      data: { lockedUntil: new Date(0) },
    });
    const recovered = await worker.claimNotification();
    assert.equal(recovered.id, interrupted.id);
    assert.notEqual(recovered.leaseToken, interrupted.leaseToken);
    shouldFail = false;
    await worker.deliverNotification(interrupted);
    assert.equal(
      (await prisma.notificationJob.findUnique({ where: { id: first.id } }))
        .status,
      "PROCESSING",
      "stale workers cannot acknowledge another lease",
    );
    await worker.deliverNotification(recovered);
    assert.equal(
      (await prisma.notificationJob.findUnique({ where: { id: first.id } }))
        .status,
      "DELIVERED",
    );
    assert.ok(
      deliveries.every((d) => d.deliveryId === first.id && d.id === hook.id),
    );
    assert.equal(await worker.claimNotification(), null);
  } finally {
    if (site) {
      await prisma.notificationJob.deleteMany({
        where: { payload: { path: ["webhook", "siteId"], equals: site.id } },
      });
      await prisma.site.delete({ where: { id: site.id } });
    }
    if (user) await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});
