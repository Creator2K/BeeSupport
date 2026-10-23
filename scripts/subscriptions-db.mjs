import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { useTestDatabase } from "./test-environment.mjs";
useTestDatabase();
const { prisma } = await import("../src/lib/db.ts");
const { tenantDb } = await import("../src/lib/tenant-db.ts");
const {
  saveSubscriptionPlan,
  submitSubscriptionOrder,
  decideSubscriptionOrder,
  serializeSubscriptionOrder,
} = await import("../src/server/services/subscriptions.ts");
const { listMerchantDirectory } =
  await import("../src/server/services/merchant-directory.ts");
const stamp = randomUUID().replaceAll("-", "").slice(0, 14);
const tenantIds = [],
  planIds = [];
const decision = (overrides = {}) => ({
  decision: "CONFIRMED",
  note: "测试开通",
  paymentReference: `TEST-${stamp}`,
  acknowledged: true,
  ...overrides,
});
const quote = (plan, overrides = {}) => ({
  planId: plan.id,
  expectedVersion: plan.updatedAt.toISOString(),
  clientRequestId: randomUUID(),
  note: "验收订单",
  ...overrides,
});
try {
  const owner = await prisma.user.findFirstOrThrow({
    where: { role: "ADMIN", active: true },
  });
  const platform = { ...owner, siteIds: null };
  const users = [];
  for (const suffix of ["a", "b"]) {
    const tenant = await prisma.tenant.create({
      data: {
        name: `订单验收 ${stamp} ${suffix}`,
        slug: `billing-${stamp}-${suffix}`,
        expiresAt: new Date(Date.now() + 10 * 86400000),
        users: {
          create: {
            email: `bill-${stamp}-${suffix}@test.local`,
            name: "商家管理员",
            passwordHash: "unused",
            role: "MERCHANT_ADMIN",
          },
        },
      },
      include: { users: true },
    });
    tenantIds.push(tenant.id);
    users.push({ ...tenant.users[0], siteIds: [] });
  }
  const [a, b] = users;
  const input = {
    name: `验收套餐 ${stamp}`,
    description: "owned fixture",
    priceCents: 1999,
    durationDays: 30,
    maxAgents: 5,
    maxSites: 3,
    monthlyConversations: 3000,
    storageMB: 10,
    active: true,
    sortOrder: 0,
  };
  await assert.rejects(saveSubscriptionPlan(a, input), { status: 403 });
  const plan = await saveSubscriptionPlan(platform, input);
  planIds.push(plan.id);
  const request = quote(plan);
  const submitted = await Promise.all(
    Array.from({ length: 6 }, () => submitSubscriptionOrder(a, request)),
  );
  const order = submitted[0];
  assert.ok(submitted.every((r) => r.id === order.id));
  assert.equal(
    await prisma.subscriptionOrder.count({ where: { tenantId: a.tenantId } }),
    1,
  );
  await assert.rejects(submitSubscriptionOrder(a, quote(plan)), {
    status: 409,
  });
  const updated = await saveSubscriptionPlan(
    platform,
    {
      ...input,
      priceCents: 2999,
      durationDays: 60,
      maxAgents: 8,
      active: false,
    },
    plan.id,
    plan.updatedAt.toISOString(),
  );
  await assert.rejects(
    saveSubscriptionPlan(
      platform,
      input,
      plan.id,
      plan.updatedAt.toISOString(),
    ),
    { status: 409 },
  );
  await assert.rejects(submitSubscriptionOrder(b, quote(updated)), {
    status: 400,
  });
  const before = await prisma.tenant.findUniqueOrThrow({
    where: { id: a.tenantId },
  });
  await assert.rejects(decideSubscriptionOrder(a, order.id, decision()), {
    status: 403,
  });
  await assert.rejects(
    decideSubscriptionOrder(b, order.id, decision({ decision: "CANCELLED" })),
    { status: 404 },
  );
  await assert.rejects(
    decideSubscriptionOrder(
      platform,
      order.id,
      decision({ acknowledged: false }),
    ),
    { status: 400 },
  );
  await assert.rejects(
    decideSubscriptionOrder(
      platform,
      order.id,
      decision({ paymentReference: "" }),
    ),
    { status: 400 },
  );
  const confirmed = await Promise.all(
    Array.from({ length: 8 }, () =>
      decideSubscriptionOrder(platform, order.id, decision()),
    ),
  );
  assert.equal(confirmed.filter((r) => r.changed).length, 1);
  const after = await prisma.tenant.findUniqueOrThrow({
    where: { id: a.tenantId },
  });
  assert.equal(
    after.expiresAt.getTime(),
    before.expiresAt.getTime() + 30 * 86400000,
  );
  assert.equal(after.maxAgents, 5); // immutable quote, despite edits and delisting
  const audit = await prisma.auditLog.count({
    where: { targetId: order.id, action: "subscription.order.confirmed" },
  });
  assert.equal(audit, 1);
  const record = await prisma.subscriptionOrder.findUniqueOrThrow({
    where: { id: order.id },
    include: { tenant: { select: { name: true } } },
  });
  assert.equal("paymentReference" in serializeSubscriptionOrder(record), false);
  assert.equal(
    serializeSubscriptionOrder(record, true).paymentReference,
    `TEST-${stamp}`,
  );
  console.log(
    "PASS: six submissions create one immutable quote; eight confirmations grant one renewal with atomic audit",
  );

  const current = await saveSubscriptionPlan(
    platform,
    { ...input, priceCents: 2999 },
    plan.id,
    updated.updatedAt.toISOString(),
  );
  await assert.rejects(submitSubscriptionOrder(b, quote(plan)), {
    status: 409,
  });
  const bo = await submitSubscriptionOrder(b, quote(current));
  await assert.rejects(decideSubscriptionOrder(platform, bo.id, decision()), {
    status: 409,
  });
  assert.equal(
    (await prisma.subscriptionOrder.findUnique({ where: { id: bo.id } }))
      .status,
    "PENDING",
  );
  await assert.rejects(
    decideSubscriptionOrder(
      platform,
      bo.id,
      decision({ decision: "REJECTED", note: "" }),
    ),
    { status: 400 },
  );
  await decideSubscriptionOrder(
    platform,
    bo.id,
    decision({ decision: "REJECTED", note: "测试拒绝" }),
  );
  const db = tenantDb(a);
  assert.equal(
    await db.subscriptionOrder.findUnique({ where: { id: bo.id } }),
    null,
  );
  await assert.rejects(
    db.subscriptionOrder.update({
      where: { id: order.id },
      data: { status: "PENDING" },
    }),
    { status: 403 },
  );
  await assert.rejects(
    db.subscriptionPlan.update({
      where: { id: plan.id },
      data: { priceCents: 0 },
    }),
    { status: 403 },
  );
  console.log(
    "PASS: receipt reuse, stale quotes, merchant approval, cross-tenant access and direct financial writes are rejected",
  );

  const expired = await submitSubscriptionOrder(a, quote(current));
  await prisma.subscriptionOrder.update({
    where: { id: expired.id },
    data: { validUntil: new Date(Date.now() - 1000) },
  });
  await assert.rejects(
    decideSubscriptionOrder(platform, expired.id, decision()),
    { status: 400 },
  );
  const replacement = await submitSubscriptionOrder(a, quote(current));
  assert.equal(
    (await prisma.subscriptionOrder.findUnique({ where: { id: expired.id } }))
      .status,
    "EXPIRED",
  );
  const races = await Promise.allSettled([
    decideSubscriptionOrder(
      platform,
      replacement.id,
      decision({ paymentReference: `TEST-${stamp}-race` }),
    ),
    decideSubscriptionOrder(
      a,
      replacement.id,
      decision({ decision: "CANCELLED" }),
    ),
  ]);
  assert.equal(races.filter((r) => r.status === "fulfilled").length, 1);
  const race = await prisma.subscriptionOrder.findUniqueOrThrow({
    where: { id: replacement.id },
  });
  assert.ok(["CONFIRMED", "CANCELLED"].includes(race.status));
  console.log(
    "PASS: expired quotes are replaceable; cancellation and confirmation have a single winner",
  );

  const narrowInput = { ...input, name: `限额验收 ${stamp}`, maxSites: 1 };
  const narrow = await saveSubscriptionPlan(platform, narrowInput);
  planIds.push(narrow.id);
  const downgrade = await submitSubscriptionOrder(b, quote(narrow));
  for (const index of [1, 2])
    await prisma.site.create({
      data: {
        tenantId: b.tenantId,
        name: "限额站点",
        slug: `bill-${stamp}-${index}`,
      },
    });
  const beforeQuota = (
    await prisma.tenant.findUniqueOrThrow({ where: { id: b.tenantId } })
  ).expiresAt;
  await assert.rejects(
    decideSubscriptionOrder(
      platform,
      downgrade.id,
      decision({ paymentReference: `TEST-${stamp}-quota` }),
    ),
    { status: 400 },
  );
  assert.equal(
    (await prisma.subscriptionOrder.findUnique({ where: { id: downgrade.id } }))
      .status,
    "PENDING",
  );
  assert.equal(
    (
      await prisma.tenant.findUniqueOrThrow({ where: { id: b.tenantId } })
    ).expiresAt.getTime(),
    beforeQuota.getTime(),
  );
  await decideSubscriptionOrder(
    b,
    downgrade.id,
    decision({ decision: "CANCELLED" }),
  );
  await prisma.tenant.update({
    where: { id: b.tenantId },
    data: { status: "SUSPENDED" },
  });
  await assert.rejects(submitSubscriptionOrder(b, quote(current)), {
    status: 403,
  });
  console.log(
    "PASS: quota downgrade and suspended tenant attempts cannot change entitlements",
  );

  for (let i = 0; i < 22; i++) {
    const tenant = await prisma.tenant.create({
      data: { name: `分页验收 ${stamp} ${i}`, slug: `bill-page-${stamp}-${i}` },
    });
    tenantIds.push(tenant.id);
  }
  const directory = await listMerchantDirectory(platform, {
    search: stamp,
    status: "",
    page: 1,
  });
  assert.equal(directory.total, 24);
  assert.equal(directory.tenants.length, 20);
  const page2 = await listMerchantDirectory(platform, {
    search: stamp,
    status: "",
    page: 2,
  });
  assert.equal(page2.tenants.length, 4);
  assert.ok(
    page2.tenants.every(
      (t) => !directory.tenants.some((other) => other.id === t.id),
    ),
  );
  assert.equal(
    (
      await listMerchantDirectory(platform, {
        search: "' OR TRUE--",
        status: "",
        page: 1,
      })
    ).total,
    0,
  );
  await assert.rejects(
    listMerchantDirectory(a, { search: "", status: "", page: 1 }),
    { status: 403 },
  );
  console.log(
    "PASS: server directory pagination covers all matches and batched usage stays scoped",
  );
} finally {
  await prisma.subscriptionOrder.deleteMany({
    where: { tenantId: { in: tenantIds } },
  });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { tenantId: { in: tenantIds } },
        { targetType: "SubscriptionPlan", targetId: { in: planIds } },
      ],
    },
  });
  await prisma.subscriptionPlan.deleteMany({ where: { id: { in: planIds } } });
  await prisma.site.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
}
