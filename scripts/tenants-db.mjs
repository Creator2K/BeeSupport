/** Uses only owned fixtures. The operator must explicitly select TEST_DATABASE_URL. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { useTestDatabase } from "./test-environment.mjs";
useTestDatabase();
const { prisma } = await import("../src/lib/db.ts");
const { tenantDb } = await import("../src/lib/tenant-db.ts");
const { assertTenantQuota, getWidgetSettings, resourceTenantId } =
  await import("../src/server/services/tenants.ts");
const { getVisitorAnalytics } =
  await import("../src/server/services/visitor-analytics.ts");
const { getOverviewStats } = await import("../src/server/services/overview.ts");
const { assertVisitorContentAllowed } =
  await import("../src/server/services/risk.ts");
const { resolveUserFromToken, signSessionToken } =
  await import("../src/lib/auth.ts");
const { signVisitorToken, verifyVisitorToken } =
  await import("../src/lib/visitor-auth.ts");
const stamp = randomUUID().replaceAll("-", "").slice(0, 16);
const owned = [];
try {
  for (const suffix of ["a", "b"]) {
    const tenant = await prisma.tenant.create({
      data: {
        name: `托管验收-${stamp}-${suffix}`,
        slug: `saas-${stamp}-${suffix}`,
        maxSites: 2,
        maxAgents: 2,
        monthlyConversations: 2,
        storageMB: 1,
        defaults: { title: `商家 ${suffix}`, imagesEnabled: false },
        users: {
          create: {
            name: "商家管理员",
            email: `saas-${stamp}-${suffix}@test.local`,
            passwordHash: "unused",
            role: "MERCHANT_ADMIN",
          },
        },
        sites: {
          create: {
            name: `站点 ${suffix}`,
            slug: `saas-${stamp}-${suffix}`,
            publicKey: `saas-${stamp}-${suffix}`,
          },
        },
      },
      include: { users: true, sites: true },
    });
    owned.push(tenant);
  }
  const [a, b] = owned;
  const [sa, sb] = [a.sites[0], b.sites[0]];
  const session = await resolveUserFromToken(
    await signSessionToken({
      userId: a.users[0].id,
      role: "MERCHANT_ADMIN",
      tokenVersion: 0,
    }),
  );
  assert.deepEqual(session.siteIds, [sa.id]);
  const db = tenantDb(session);
  assert.equal(
    await resourceTenantId({ ...session, role: "ADMIN" }, sb.id),
    b.id,
  );
  await assert.rejects(resourceTenantId(session, sb.id), { status: 403 });
  const upserted = await db.cannedResponse.upsert({
    where: { id: `upsert-${stamp}` },
    create: { id: `upsert-${stamp}`, title: "upsert", content: "owned" },
    update: { content: "owned" },
  });
  assert.equal(upserted.tenantId, a.id);
  assert.equal((await db.site.findMany()).length, 1);
  assert.equal(await db.site.findUnique({ where: { id: sb.id } }), null);
  await assert.rejects(
    db.site.update({ where: { id: sb.id }, data: { name: "跨商家篡改" } }),
  );
  await assert.rejects(
    db.user.update({ where: { id: a.users[0].id }, data: { role: "ADMIN" } }),
    { status: 403 },
  );
  await assert.rejects(
    db.cannedResponse.create({
      data: { title: "越权话术", content: "x", siteId: sb.id },
    }),
    { status: 403 },
  );
  await assert.rejects(
    db.siteAgent.create({ data: { userId: a.users[0].id, siteId: sb.id } }),
    { status: 403 },
  );
  await assert.rejects(db.setting.findMany(), { status: 403 });
  await assert.rejects(db.$queryRaw`SELECT * FROM "Site"`, { status: 403 });
  await db.$transaction(async (tx) => {
    assert.equal(await tx.site.findUnique({ where: { id: sb.id } }), null);
    const canned = await tx.cannedResponse.create({
      data: { title: "团队话术", content: "own only" },
    });
    assert.equal(canned.tenantId, a.id);
  });
  console.log(
    "PASS: staff/resource/transaction isolation and privilege escalation rejection",
  );

  const visitors = [];
  for (const site of [sa, sb]) {
    const visitor = await prisma.visitor.create({
      data: { siteId: site.id, localKey: stamp, email: "v@test.local" },
    });
    visitors.push(visitor);
    await prisma.conversation.create({
      data: { siteId: site.id, visitorId: visitor.id },
    });
  }
  assert.equal(
    (await getVisitorAnalytics(undefined, 7, new Date(), a.id)).totals.visitors,
    1,
  );
  assert.equal(
    (await getVisitorAnalytics(sb.id, 7, new Date(), a.id)).totals.visitors,
    0,
  );
  assert.equal((await getOverviewStats(new Date(), a.id)).pending, 1);
  await prisma.riskRule.create({
    data: { tenantId: a.id, kind: "WORD", value: stamp },
  });
  await assert.rejects(
    assertVisitorContentAllowed({
      siteId: sa.id,
      text: stamp,
      ip: "192.0.2.1",
    }),
    { status: 403 },
  );
  await assertVisitorContentAllowed({
    siteId: sb.id,
    text: stamp,
    ip: "192.0.2.1",
  });
  assert.equal((await getWidgetSettings(sa.id)).title, "商家 a");
  assert.equal((await getWidgetSettings(sa.id)).imagesEnabled, false);
  await prisma.site.update({
    where: { id: sa.id },
    data: {
      widgetSettings: {
        title: "站点覆盖",
        imagesEnabled: true,
        footerText: "",
      },
    },
  });
  assert.equal((await getWidgetSettings(sa.id)).title, "站点覆盖");
  assert.equal((await getWidgetSettings(sa.id)).footerText, "");
  assert.equal((await getWidgetSettings(sa.id)).imagesEnabled, true);
  console.log(
    "PASS: aggregate analytics, shared risk rules and branding inheritance isolate tenants",
  );

  const result = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) =>
      db.$transaction(
        async (tx) => {
          await assertTenantQuota(tx, a.id, "sites");
          return tx.site.create({
            data: {
              name: "并发限额",
              slug: `quota-${stamp}-${i}`,
              publicKey: `quota-${stamp}-${i}`,
            },
          });
        },
        { timeout: 15000 },
      ),
    ),
  );
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await db.site.count(), 2);
  await prisma.attachment.create({
    data: {
      siteId: sa.id,
      uploader: "VISITOR",
      filename: "held.bin",
      mimeType: "application/octet-stream",
      size: 1048575,
      storageKey: `saas-test/${stamp}`,
    },
  });
  await assert.rejects(
    prisma.$transaction((tx) => assertTenantQuota(tx, a.id, "storage", 2)),
    { status: 403 },
  );
  console.log(
    "PASS: six concurrent site creations cannot exceed quota; pending files consume storage",
  );

  const visitorToken = await signVisitorToken({
    visitorId: visitors[0].id,
    siteId: sa.id,
    email: visitors[0].email,
    localKey: stamp,
  });
  assert.ok(await verifyVisitorToken(visitorToken));
  await prisma.tenant.update({
    where: { id: a.id },
    data: { expiresAt: new Date(Date.now() - 60000) },
  });
  assert.equal(await verifyVisitorToken(visitorToken), null);
  const expired = await resolveUserFromToken(
    await signSessionToken({
      userId: a.users[0].id,
      role: "MERCHANT_ADMIN",
      tokenVersion: 0,
    }),
  );
  assert.ok(expired.tenantExpired);
  await assert.rejects(
    prisma.$transaction((tx) => assertTenantQuota(tx, a.id, "conversations")),
    { status: 403 },
  );
  await prisma.tenant.update({
    where: { id: a.id },
    data: { status: "SUSPENDED" },
  });
  assert.equal(
    await resolveUserFromToken(
      await signSessionToken({
        userId: a.users[0].id,
        role: "MERCHANT_ADMIN",
        tokenVersion: 0,
      }),
    ),
    null,
  );
  console.log(
    "PASS: expiry stops visitor service while retaining staff access; suspension revokes staff",
  );
} finally {
  for (const tenant of owned) {
    await prisma.site.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.cannedResponse.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.riskRule.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.user.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
  }
  await prisma.$disconnect();
}
