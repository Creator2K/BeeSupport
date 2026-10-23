import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { useTestDatabase, restoreSetting } from "./test-environment.mjs";
useTestDatabase();
const { prisma: db } = await import("../src/lib/db.ts");
const { getCollectionSettings, saveCollectionSettings } =
  await import("../src/server/services/collection.ts");
const {
  reportSubscriptionPayment,
  decideSubscriptionOrder,
  serializeSubscriptionOrder,
} = await import("../src/server/services/subscriptions.ts");
const { visibleNoticeWhere } =
  await import("../src/server/services/account-notices.ts");
const { COLLECTION_KEY, DEFAULT_COLLECTION } =
  await import("../src/lib/collection.ts");
const stamp = randomUUID().slice(0, 12),
  tenantIds = [],
  userIds = [],
  planIds = [];
const saved = await db.setting.findUnique({ where: { key: COLLECTION_KEY } });
let platform, plan, a, b;
const report = (note = "微信付款，测试流水末尾 1234", expectedVersion = 0) => ({
  note,
  expectedVersion,
  acknowledged: true,
});
const decision = (overrides = {}) => ({
  decision: "CONFIRMED",
  note: "收款已核实",
  paymentReference: `COLLECTION-${stamp}`,
  acknowledged: true,
  ...overrides,
});
async function order(overrides = {}) {
  return db.subscriptionOrder.create({
    data: {
      tenantId: a.tenantId,
      planId: plan.id,
      clientRequestId: randomUUID(),
      orderNo: `TEST-COLLECTION-${randomUUID()}`,
      planName: plan.name,
      priceCents: plan.priceCents,
      durationDays: 30,
      maxAgents: 10,
      maxSites: 5,
      monthlyConversations: 3000,
      storageMB: 100,
      requestedById: a.id,
      requestedByName: a.name,
      validUntil: new Date(Date.now() + 86400000),
      ...overrides,
    },
  });
}
try {
  const base = await db.user.findFirstOrThrow({
    where: { role: "ADMIN", active: true },
  });
  platform = await db.user.create({
    data: {
      tenantId: base.tenantId,
      name: "收款验收平台",
      email: `collection-admin-${stamp}@test.local`,
      role: "ADMIN",
      passwordHash: "unused",
    },
  });
  userIds.push(platform.id);
  const owners = [];
  for (const suffix of ["a", "b"]) {
    const tenant = await db.tenant.create({
      data: {
        name: `收款验收 ${stamp} ${suffix}`,
        slug: `collection-db-${stamp}-${suffix}`,
        expiresAt: new Date(Date.now() + 10 * 86400000),
        users: {
          create: {
            name: "验收商家",
            email: `collection-${stamp}-${suffix}@test.local`,
            role: "MERCHANT_ADMIN",
            passwordHash: "unused",
          },
        },
      },
      include: { users: true },
    });
    tenantIds.push(tenant.id);
    owners.push(tenant.users[0]);
  }
  [a, b] = owners;
  const otherAdmin = await db.user.create({
    data: {
      tenantId: a.tenantId,
      name: "同商家管理员",
      email: `collection-${stamp}-other@test.local`,
      role: "MERCHANT_ADMIN",
      passwordHash: "unused",
    },
  });
  const agent = await db.user.create({
    data: {
      tenantId: a.tenantId,
      name: "客服",
      email: `collection-${stamp}-agent@test.local`,
      role: "AGENT",
      passwordHash: "unused",
    },
  });
  plan = await db.subscriptionPlan.create({
    data: {
      name: `收款验收套餐 ${stamp}`,
      description: "test",
      priceCents: 1999,
      durationDays: 30,
      maxAgents: 10,
      maxSites: 5,
      monthlyConversations: 3000,
      storageMB: 100,
    },
  });
  planIds.push(plan.id);
  const settings = {
    ...DEFAULT_COLLECTION,
    enabled: true,
    instructions: "验收用收款说明，不实际付款",
  };
  const initial = await getCollectionSettings();
  await assert.rejects(saveCollectionSettings(a, settings, initial.revision), {
    status: 403,
  });
  const saves = await Promise.allSettled([
    saveCollectionSettings(platform, settings, initial.revision),
    saveCollectionSettings(
      platform,
      { ...settings, contact: "第二管理员" },
      initial.revision,
    ),
  ]);
  assert.equal(saves.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(saves.find((x) => x.status === "rejected").reason.status, 409);
  console.log(
    "PASS: platform-only collection settings, atomic audit and stale-version protection",
  );
  const first = await order();
  const before = await db.tenant.findUniqueOrThrow({
    where: { id: a.tenantId },
  });
  const reports = await Promise.all(
    Array.from({ length: 8 }, () =>
      reportSubscriptionPayment(a, first.id, report()),
    ),
  );
  assert.equal(reports.filter((x) => x.changed).length, 1);
  assert.equal(
    (await db.subscriptionOrder.findUniqueOrThrow({ where: { id: first.id } }))
      .paymentReportVersion,
    1,
  );
  assert.equal(
    await db.auditLog.count({
      where: {
        targetId: first.id,
        action: "subscription.order.payment_report",
      },
    }),
    1,
  );
  const after = await db.tenant.findUniqueOrThrow({
    where: { id: a.tenantId },
  });
  assert.equal(after.expiresAt.getTime(), before.expiresAt.getTime());
  assert.equal(after.planName, before.planName);
  await assert.rejects(reportSubscriptionPayment(b, first.id, report()), {
    status: 404,
  });
  await assert.rejects(reportSubscriptionPayment(agent, first.id, report()), {
    status: 403,
  });
  await assert.rejects(
    reportSubscriptionPayment(platform, first.id, report()),
    { status: 404 },
  );
  await assert.rejects(
    reportSubscriptionPayment(a, first.id, report("旧窗口不同信息")),
    { status: 409 },
  );
  const edits = await Promise.allSettled([
    reportSubscriptionPayment(a, first.id, report("更新 A", 1)),
    reportSubscriptionPayment(a, first.id, report("更新 B", 1)),
  ]);
  assert.equal(edits.filter((x) => x.status === "fulfilled").length, 1);
  await decideSubscriptionOrder(
    a,
    first.id,
    decision({ decision: "CANCELLED" }),
  );
  await assert.rejects(reportSubscriptionPayment(a, first.id, report()), {
    status: 409,
  });
  console.log(
    "PASS: eight concurrent reports dedupe, no automatic opening, tenant/role isolation and edit conflicts",
  );
  const expired = await order({ validUntil: new Date(Date.now() - 1000) });
  await assert.rejects(reportSubscriptionPayment(a, expired.id, report()), {
    status: 409,
  });
  await decideSubscriptionOrder(
    a,
    expired.id,
    decision({ decision: "CANCELLED" }),
  );
  const free = await order({ priceCents: 0 });
  await assert.rejects(reportSubscriptionPayment(a, free.id, report()), {
    status: 400,
  });
  await decideSubscriptionOrder(
    a,
    free.id,
    decision({ decision: "CANCELLED" }),
  );
  const suspended = await order();
  await db.tenant.update({
    where: { id: a.tenantId },
    data: { status: "SUSPENDED" },
  });
  await assert.rejects(reportSubscriptionPayment(a, suspended.id, report()), {
    status: 403,
  });
  await db.tenant.update({
    where: { id: a.tenantId },
    data: { status: "ACTIVE" },
  });
  await decideSubscriptionOrder(
    a,
    suspended.id,
    decision({ decision: "CANCELLED" }),
  );
  console.log(
    "PASS: expired, cancelled, free and suspended orders cannot report payment",
  );
  const raced = await order();
  await Promise.allSettled([
    reportSubscriptionPayment(a, raced.id, report()),
    decideSubscriptionOrder(platform, raced.id, decision()),
  ]);
  const confirmed = await db.subscriptionOrder.findUniqueOrThrow({
    where: { id: raced.id },
    include: { tenant: { select: { name: true } } },
  });
  assert.equal(confirmed.status, "CONFIRMED");
  const retried = await decideSubscriptionOrder(platform, raced.id, decision());
  assert.equal(retried.changed, false);
  const notices = await db.accountNotice.findMany({
    where: { dedupeKey: `order:${raced.id}:CONFIRMED` },
  });
  assert.equal(notices.length, 2);
  assert.deepEqual(
    new Set(notices.map((x) => x.userId)),
    new Set([a.id, otherAdmin.id]),
  );
  assert.ok(notices.every((x) => !x.body.includes(`COLLECTION-${stamp}`)));
  assert.equal(
    await db.accountNotice.count({
      where: {
        ...(await visibleNoticeWhere(b)),
        dedupeKey: notices[0].dedupeKey,
      },
    }),
    0,
  );
  assert.equal(
    "paymentReference" in serializeSubscriptionOrder(confirmed),
    false,
  );
  await assert.rejects(reportSubscriptionPayment(a, raced.id, report()), {
    status: 409,
  });
  console.log(
    "PASS: reporting/confirmation races, one-time opening, deduped merchant notices and private reference protection",
  );
  const rejected = await order();
  await reportSubscriptionPayment(a, rejected.id, report());
  await decideSubscriptionOrder(
    platform,
    rejected.id,
    decision({ decision: "REJECTED", note: "请核对付款渠道" }),
  );
  const rejectedNotices = await db.accountNotice.findMany({
    where: { dedupeKey: `order:${rejected.id}:REJECTED` },
  });
  assert.equal(rejectedNotices.length, 2);
  assert.ok(rejectedNotices.every((x) => x.body.includes("请核对付款渠道")));
  console.log(
    "PASS: rejection preserves payment feedback and delivers the platform explanation to merchant admins",
  );
} finally {
  await db.subscriptionOrder.deleteMany({
    where: { tenantId: { in: tenantIds } },
  });
  await db.auditLog.deleteMany({
    where: {
      OR: [{ tenantId: { in: tenantIds } }, { actorId: { in: userIds } }],
    },
  });
  await db.user.deleteMany({
    where: { OR: [{ id: { in: userIds } }, { tenantId: { in: tenantIds } }] },
  });
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await db.subscriptionPlan.deleteMany({ where: { id: { in: planIds } } });
  await restoreSetting(db, COLLECTION_KEY, saved);
  await db.$disconnect();
  console.log(
    "Owned collection fixtures removed; collection settings restored",
  );
}
