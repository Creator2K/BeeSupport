import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { useTestDatabase } from "./test-environment.mjs";
import { deliveryService } from "../tests/delivery-fixtures.mjs";
import {
  accountMail,
  accountLinks as links,
  accountSecret,
} from "../tests/account-fixtures.mjs";
useTestDatabase();
const { prisma: db } = await import("../src/lib/db.ts");
const stamp = randomUUID().slice(0, 12),
  prefix = `delivery-db-${stamp}`,
  jobIds = [],
  tokenIds = [];
let actor, site, endpoint;
const delayed = new Proxy(db, {
  get(target, property) {
    if (property !== "$transaction") return Reflect.get(target, property);
    return (run, options) =>
      db.$transaction(
        (tx) =>
          run(
            new Proxy(tx, {
              get(inner, key) {
                if (key !== "notificationJob") return Reflect.get(inner, key);
                return new Proxy(tx.notificationJob, {
                  get(delegate, method) {
                    if (method !== "updateMany")
                      return Reflect.get(delegate, method);
                    return (args) =>
                      delegate.updateMany({
                        ...args,
                        data: {
                          ...args.data,
                          ...(args.data.status === "PENDING"
                            ? { availableAt: new Date("2100-01-01") }
                            : {}),
                        },
                      });
                  },
                });
              },
            }),
          ),
        options,
      );
  },
});
const mail = accountMail(db, async () => {
  throw Error("Database validation must never send mail");
});
const service = deliveryService(delayed, { account: mail.prepareAccountMail });
async function job(suffix, data = {}) {
  const row = await db.notificationJob.create({
    data: {
      id: `${prefix}-${suffix}`,
      kind: "MAIL",
      status: "FAILED",
      attempts: 5,
      totalAttempts: 5,
      payload: {
        to: "nobody@test.local",
        subject: "private-subject",
        text: "private-body https://private.test/#token=private-credential",
      },
      lastError: "535 SMTP secret-password https://user:password@private.test",
      ...data,
    },
  });
  jobIds.push(row.id);
  return row;
}
const version = (row) => ({
  id: row.id,
  updatedAt: row.updatedAt.toISOString(),
  manualRetries: row.manualRetries,
});
try {
  const base = await db.user.findFirstOrThrow({
    where: { role: "ADMIN", active: true },
    select: { tenantId: true },
  });
  actor = await db.user.create({
    data: {
      tenantId: base.tenantId,
      email: `${prefix}@test.local`,
      name: "投递验收平台",
      role: "ADMIN",
      passwordHash: "unused",
    },
  });
  const failed = await job("failed");
  const race = await Promise.allSettled([
    service.retryDelivery(actor, version(failed)),
    service.retryDelivery(actor, version(failed)),
  ]);
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(race.find((r) => r.status === "rejected").reason.status, 409);
  const queued = await db.notificationJob.findUniqueOrThrow({
    where: { id: failed.id },
  });
  assert.equal(queued.status, "PENDING");
  assert.equal(queued.manualRetries, 1);
  assert.equal(queued.attempts, 0);
  assert.equal(queued.totalAttempts, 5);
  assert.equal(
    await db.auditLog.count({
      where: { actorId: actor.id, action: "notification.retry" },
    }),
    1,
  );
  await assert.rejects(service.retryDelivery(actor, version(failed)), {
    status: 409,
  });
  for (const role of ["AGENT", "MERCHANT_ADMIN"]) {
    await assert.rejects(
      service.getDeliveries({ ...actor, role }, { search: prefix }),
      { status: 403 },
    );
    await assert.rejects(
      service.retryDelivery({ ...actor, role }, version(queued)),
      { status: 403 },
    );
  }
  console.log(
    "PASS: concurrent retries commit once, preserve cumulative counts, audit atomically and reject stale or non-platform requests",
  );

  const unavailable = await job("smtp");
  await assert.rejects(
    deliveryService(delayed, { smtp: async () => null }).retryDelivery(
      actor,
      version(unavailable),
    ),
    { status: 400 },
  );
  const expiredRaw = links.newAccountToken();
  const token = await db.accountToken.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.id,
      email: actor.email,
      purpose: "RESET",
      tokenVersion: actor.tokenVersion,
      tokenHash: links.accountTokenHash(expiredRaw),
      expiresAt: new Date(Date.now() - 1000),
    },
  });
  tokenIds.push(token.id);
  const expired = await job("expired", {
    kind: "ACCOUNT_MAIL",
    payload: {
      tokenId: token.id,
      encrypted: links.sealAccountToken(expiredRaw, accountSecret),
    },
  });
  await assert.rejects(service.retryDelivery(actor, version(expired)), {
    status: 400,
  });
  assert.equal(
    (
      await db.accountToken.findUniqueOrThrow({ where: { id: token.id } })
    ).expiresAt.getTime(),
    token.expiresAt.getTime(),
  );
  const reminder = await job("reminder", {
    kind: "SUBSCRIPTION_MAIL",
    payload: { noticeId: "missing", phase: 1 },
  });
  await assert.rejects(service.retryDelivery(actor, version(reminder)), {
    status: 400,
  });
  assert.equal(
    (await db.notificationJob.findUniqueOrThrow({ where: { id: expired.id } }))
      .status,
    "FAILED",
  );
  console.log(
    "PASS: missing SMTP, expired account links and obsolete reminders cannot be retried or extended",
  );

  site = await db.site.create({
    data: {
      tenantId: actor.tenantId,
      name: "投递验收",
      slug: `${prefix}-site`,
    },
  });
  endpoint = await db.webhookEndpoint.create({
    data: {
      tenantId: actor.tenantId,
      name: "隔离测试目标",
      type: "GENERIC",
      url: "http://127.0.0.1:1/not-sent",
      active: false,
      siteId: site.id,
      events: ["conversation.created"],
    },
  });
  const webhook = await job("webhook", {
    kind: "WEBHOOK",
    payload: {
      endpointId: endpoint.id,
      webhook: { siteId: site.id, event: "conversation.created" },
    },
  });
  await assert.rejects(service.retryDelivery(actor, version(webhook)), {
    status: 400,
  });
  await db.webhookEndpoint.update({
    where: { id: endpoint.id },
    data: { active: true },
  });
  await service.retryDelivery(actor, version(webhook));
  assert.equal(
    (await db.notificationJob.findUniqueOrThrow({ where: { id: webhook.id } }))
      .status,
    "PENDING",
  );
  console.log(
    "PASS: webhook retry rechecks the channel, event and site before queueing without sending from the request",
  );

  await job("success", {
    status: "DELIVERED",
    outcome: "SUCCESS",
    completedAt: new Date(),
  });
  await job("skip", {
    status: "DELIVERED",
    outcome: "SKIPPED",
    completedAt: new Date(),
  });
  await job("legacy", {
    status: "DELIVERED",
    outcome: null,
    completedAt: new Date(),
  });
  for (let i = 0; i < 22; i++) await job(`pagination-${i}`);
  const all = await service.getDeliveries(actor, { search: prefix, page: 999 });
  assert.equal(all.total, jobIds.length);
  assert.equal(all.page, 2);
  assert.equal(all.rows.length, jobIds.length - 20);
  const skipped = await service.getDeliveries(actor, {
    search: prefix,
    state: "SKIPPED",
  });
  assert.equal(skipped.total, 1);
  assert.equal(skipped.rows[0].state, "SKIPPED");
  assert.equal(skipped.counts.SUCCESS, 1);
  assert.equal(skipped.counts.LEGACY, 1);
  const first = await service.getDeliveries(actor, { search: prefix });
  for (const forbidden of [
    "private-body",
    "private-subject",
    "private-credential",
    "secret-password",
    "nobody@test.local",
    "encrypted",
    "leaseToken",
    "lastError",
  ])
    assert.equal(
      JSON.stringify([first, all, skipped]).includes(forbidden),
      false,
    );
  console.log(
    "PASS: paginated filtering and consistent state counts never expose payloads, credentials or raw errors",
  );
  console.log("Delivery database validation: 4 groups passed");
} finally {
  await db.notificationJob.deleteMany({ where: { id: { in: jobIds } } });
  await db.accountToken.deleteMany({ where: { id: { in: tokenIds } } });
  if (endpoint)
    await db.webhookEndpoint.deleteMany({ where: { id: endpoint.id } });
  if (site) await db.site.deleteMany({ where: { id: site.id } });
  if (actor) {
    await db.auditLog.deleteMany({ where: { actorId: actor.id } });
    await db.user.deleteMany({ where: { id: actor.id } });
  }
  await db.$disconnect();
}
