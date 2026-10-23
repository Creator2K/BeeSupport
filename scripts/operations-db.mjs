import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { useTestDatabase } from "./test-environment.mjs";
useTestDatabase();
const { prisma: db } = await import("../src/lib/db.ts");
const { saveManagedTenant } =
  await import("../src/server/services/tenant-management.ts");
const {
  submitSubscriptionOrder,
  decideSubscriptionOrder,
  saveSubscriptionPlan,
} = await import("../src/server/services/subscriptions.ts");
const { getWidgetSettings } = await import("../src/server/services/tenants.ts");
const { getVisitorAnalytics } =
  await import("../src/server/services/visitor-analytics.ts");
const { getOperations } = await import("../src/server/services/operations.ts");
const { tenantDb } = await import("../src/lib/tenant-db.ts");
const { readFeatures, BASIC_FEATURES, LEGACY_FEATURES } =
  await import("../src/lib/entitlements.ts");
const { operationWindow } = await import("../src/lib/operations.ts");
const { mergeWidgetSettings } = await import("../src/lib/branding.ts");
const stamp = randomUUID().slice(0, 12),
  tenantIds = [],
  planIds = [],
  userIds = [];
let platform, a, b, plan, site;
const tenantInput = (t) => ({
  name: t.name,
  slug: t.slug,
  status: t.status,
  planName: t.planName,
  expiresAt: t.expiresAt?.toISOString() ?? null,
  maxAgents: t.maxAgents,
  maxSites: t.maxSites,
  monthlyConversations: t.monthlyConversations,
  storageMB: t.storageMB,
  contactEmail: t.contactEmail ?? "",
  note: t.note ?? "",
  features: readFeatures(t.features),
});
try {
  const base = await db.user.findFirstOrThrow({
    where: { role: "ADMIN", active: true },
  });
  platform = await db.user.create({
    data: {
      tenantId: base.tenantId,
      name: "运营验收平台",
      email: `operations-platform-${stamp}@test.local`,
      role: "ADMIN",
      passwordHash: "unused",
    },
  });
  userIds.push(platform.id);
  const owners = [];
  for (const suffix of ["a", "b"]) {
    const tenant = await db.tenant.create({
      data: {
        name: `运营验收 ${stamp} ${suffix}`,
        slug: `operations-db-${stamp}-${suffix}`,
        expiresAt: new Date(Date.now() + 10 * 86400000),
        users: {
          create: {
            name: "验收商家",
            email: `operations-${stamp}-${suffix}@test.local`,
            role: "MERCHANT_ADMIN",
            passwordHash: "unused",
          },
        },
      },
      include: { users: true },
    });
    tenantIds.push(tenant.id);
    owners.push({ ...tenant.users[0], siteIds: [] });
  }
  [a, b] = owners;
  const planInput = {
    name: `运营验收套餐 ${stamp}`,
    description: "test",
    priceCents: 1999,
    durationDays: 30,
    maxAgents: 5,
    maxSites: 3,
    monthlyConversations: 3000,
    storageMB: 100,
    active: true,
    sortOrder: 0,
    features: BASIC_FEATURES,
  };
  plan = await saveSubscriptionPlan(platform, planInput);
  planIds.push(plan.id);
  const before = await db.tenant.findUniqueOrThrow({
      where: { id: a.tenantId },
    }),
    oldInput = tenantInput(before);
  const order = await submitSubscriptionOrder(a, {
    planId: plan.id,
    expectedVersion: plan.updatedAt.toISOString(),
    clientRequestId: randomUUID(),
    note: "owned fixture",
  });
  await saveSubscriptionPlan(
    platform,
    { ...planInput, features: LEGACY_FEATURES },
    plan.id,
    plan.updatedAt.toISOString(),
  );
  assert.deepEqual(readFeatures(order.features), BASIC_FEATURES);
  await decideSubscriptionOrder(platform, order.id, {
    decision: "CONFIRMED",
    note: "已核实",
    paymentReference: `OPS-${stamp}`,
    acknowledged: true,
  });
  const renewed = await db.tenant.findUniqueOrThrow({
    where: { id: a.tenantId },
  });
  assert.equal(renewed.managementVersion, before.managementVersion + 1);
  assert.deepEqual(readFeatures(renewed.features), BASIC_FEATURES);
  await assert.rejects(
    saveManagedTenant(
      platform,
      { ...oldInput, note: "旧页覆盖" },
      a.tenantId,
      undefined,
      before.managementVersion,
    ),
    { status: 409 },
  );
  assert.equal(
    (
      await db.tenant.findUniqueOrThrow({ where: { id: a.tenantId } })
    ).expiresAt.getTime(),
    renewed.expiresAt.getTime(),
  );
  console.log(
    "PASS: immutable feature snapshots, renewal increments management version and stale merchant edits cannot overwrite entitlements",
  );
  const currentInput = tenantInput(renewed);
  await assert.rejects(
    saveManagedTenant(
      a,
      currentInput,
      a.tenantId,
      undefined,
      renewed.managementVersion,
    ),
    { status: 403 },
  );
  await assert.rejects(saveManagedTenant(platform, currentInput, a.tenantId), {
    status: 400,
  });
  const edits = await Promise.allSettled([
    saveManagedTenant(
      platform,
      { ...currentInput, note: "编辑 A" },
      a.tenantId,
      undefined,
      renewed.managementVersion,
    ),
    saveManagedTenant(
      platform,
      { ...currentInput, note: "编辑 B" },
      a.tenantId,
      undefined,
      renewed.managementVersion,
    ),
  ]);
  assert.equal(edits.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(edits.find((x) => x.status === "rejected").reason.status, 409);
  assert.equal(
    await db.auditLog.count({
      where: { targetId: a.tenantId, action: "tenant.update" },
    }),
    1,
  );
  await assert.rejects(
    tenantDb(a).tenant.update({
      where: { id: a.tenantId },
      data: { features: LEGACY_FEATURES },
    }),
    { status: 403 },
  );
  await tenantDb(a).tenant.update({
    where: { id: a.tenantId },
    data: { updatedAt: new Date() },
  });
  console.log(
    "PASS: concurrent merchant edits have one winner, missing versions and direct merchant grants are rejected, quota row locking remains available",
  );
  site = await db.site.create({
    data: {
      tenantId: a.tenantId,
      name: "授权验收",
      slug: `ops-site-${stamp}`,
      publicKey: `ops-site-${stamp}`,
      widgetSettings: { footerText: "试图隐藏平台品牌" },
      embedSeenAt: new Date(),
    },
  });
  const platformBrand = (
    await db.setting.findUnique({ where: { key: "platform.brand" } })
  )?.value;
  assert.equal(
    (await getWidgetSettings(site.id)).footerText,
    mergeWidgetSettings(platformBrand).footerText.trim() ||
      "Powered by BeeSupport",
  );
  await assert.rejects(
    getVisitorAnalytics(undefined, 7, new Date(), a.tenantId),
    { status: 403 },
  );
  const restricted = await db.tenant.findUniqueOrThrow({
    where: { id: a.tenantId },
  });
  await saveManagedTenant(
    platform,
    { ...tenantInput(restricted), features: LEGACY_FEATURES },
    a.tenantId,
    undefined,
    restricted.managementVersion,
  );
  assert.equal(
    (await getWidgetSettings(site.id)).footerText,
    "试图隐藏平台品牌",
  );
  assert.equal(
    (await getVisitorAnalytics(site.id, 7, new Date(), a.tenantId)).totals
      .visitors,
    0,
  );
  console.log(
    "PASS: branding is enforced on effective public settings, advanced analytics are gated at the service boundary, grants restore saved configuration",
  );
  const now = new Date(Date.now() + 60000),
    window = operationWindow(7, now);
  const quote = {
    tenantId: a.tenantId,
    planId: plan.id,
    planName: plan.name,
    priceCents: 500,
    durationDays: 30,
    maxAgents: 5,
    maxSites: 3,
    monthlyConversations: 3000,
    storageMB: 100,
    requestedByName: "验收商家",
    validUntil: new Date(now.getTime() + 86400000),
  };
  const add = (overrides) =>
    db.subscriptionOrder.create({
      data: {
        ...quote,
        orderNo: `OPS-${randomUUID()}`,
        clientRequestId: randomUUID(),
        ...overrides,
      },
    });
  await add({ status: "CONFIRMED", reviewedAt: window.start });
  await add({
    status: "CONFIRMED",
    priceCents: 1000,
    reviewedAt: new Date(window.start.getTime() - 1),
  });
  await add({ status: "REJECTED", priceCents: 99999, reviewedAt: now });
  await add({
    tenantId: b.tenantId,
    status: "PENDING",
    priceCents: 99999,
    paymentReportedAt: now,
  });
  await db.tenant.update({
    where: { id: b.tenantId },
    data: { status: "PENDING" },
  });
  await db.tenant.update({
    where: { id: a.tenantId },
    data: { expiresAt: new Date(now.getTime() + 2 * 86400000) },
  });
  const stats = await getOperations(platform, 7, now, tenantIds);
  assert.equal(stats.summary.revenueCents, 2499);
  assert.equal(stats.summary.confirmed, 2);
  assert.equal(stats.summary.total, 2);
  assert.equal(stats.summary.pending, 1);
  assert.equal(stats.summary.pendingOrders, 1);
  assert.equal(stats.summary.reportedOrders, 1);
  assert.equal(stats.summary.repeatBuyers, 1);
  assert.equal(stats.summary.buyers, 1);
  assert.equal(stats.summary.installed, 1);
  assert.equal(stats.summary.expiring, 1);
  assert.equal(stats.trend.length, 7);
  assert.equal(
    stats.trend.reduce((n, row) => n + row.revenueCents, 0),
    2499,
  );
  assert.equal(stats.trend[0].revenueCents, 500);
  await assert.rejects(getOperations(a, 7, now, tenantIds), { status: 403 });
  assert.equal((await getOperations(platform, 7, now, [])).summary.total, 0);
  console.log(
    "PASS: operational metrics use exact integer cents, confirmed-only revenue, Beijing boundaries, real repeat buyers and platform-only reads",
  );
} finally {
  await db.subscriptionOrder.deleteMany({
    where: { tenantId: { in: tenantIds } },
  });
  await db.site.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await db.auditLog.deleteMany({
    where: {
      OR: [{ tenantId: { in: tenantIds } }, { actorId: { in: userIds } }],
    },
  });
  await db.user.deleteMany({
    where: { OR: [{ tenantId: { in: tenantIds } }, { id: { in: userIds } }] },
  });
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await db.subscriptionPlan.deleteMany({ where: { id: { in: planIds } } });
  await db.$disconnect();
  console.log("Owned operations fixtures removed");
}
