import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { useTestDatabase, restoreSetting } from "./test-environment.mjs";
import { loadModule } from "../tests/load-module.mjs";
useTestDatabase();
const { prisma } = await import("../src/lib/db.ts");
const { tenantDb } = await import("../src/lib/tenant-db.ts");
const home = await import("../src/server/services/homepage.ts");
const { DEFAULT_HOME_CONTENT } = await import("../src/lib/homepage-content.ts");
const { generateExpiryNotices } =
  await import("../src/server/services/subscription-reminders.ts");
const { visibleNoticeWhere } =
  await import("../src/server/services/account-notices.ts");
const { recordSiteEmbed, getOnboarding, loginDestination } =
  await import("../src/server/services/onboarding.ts");
const { REMINDER_SETTING_KEY } =
  await import("../src/lib/subscription-reminders.ts");
const stamp = randomUUID().slice(0, 12),
  tenantIds = [],
  userIds = [],
  planIds = [],
  keys = [home.HOME_DRAFT, home.HOME_PUBLISHED, REMINDER_SETTING_KEY];
const saved = await Promise.all(
  keys.map((key) => prisma.setting.findUnique({ where: { key } })),
);
let platform;
try {
  const existing = await prisma.user.findFirstOrThrow({
    where: { role: "ADMIN", active: true },
    select: { tenantId: true },
  });
  platform = await prisma.user.create({
    data: {
      tenantId: existing.tenantId,
      email: `growth-platform-${stamp}@test.local`,
      name: "首页验收管理员",
      role: "ADMIN",
      passwordHash: "unused",
    },
  });
  userIds.push(platform.id);
  const owners = [];
  for (const suffix of ["a", "b"]) {
    const tenant = await prisma.tenant.create({
      data: {
        slug: `growth-db-${stamp}-${suffix}`,
        name: `功能验收 ${stamp} ${suffix}`,
        expiresAt: new Date(Date.now() + 2 * 86400000),
        users: {
          create: {
            email: `growth-${stamp}-${suffix}@test.local`,
            name: "验收商家",
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
  const [a, b] = owners;
  const initial = await home.getHomeEditor(),
    draft = { ...DEFAULT_HOME_CONTENT, brandName: `验收品牌 ${stamp}` };
  await assert.rejects(home.saveHomeDraft(a, draft, initial.revision), {
    status: 403,
  });
  const attempts = await Promise.allSettled([
    home.saveHomeDraft(platform, draft, initial.revision),
    home.saveHomeDraft(
      platform,
      { ...draft, brandName: `竞争品牌 ${stamp}` },
      initial.revision,
    ),
  ]);
  assert.equal(
    attempts.filter((item) => item.status === "fulfilled").length,
    1,
  );
  assert.equal(
    attempts.find((item) => item.status === "rejected").reason.status,
    409,
  );
  let editor = await home.getHomeEditor();
  assert.equal(
    (await home.getPublishedHome()).brandName,
    initial.content.brandName,
  );
  await assert.rejects(
    home.publishHome(a, editor.revision, editor.publishedRevision),
    { status: 403 },
  );
  await home.publishHome(platform, editor.revision, editor.publishedRevision);
  assert.equal(
    (await home.getPublishedHome()).brandName,
    editor.content.brandName,
  );
  await assert.rejects(
    home.publishHome(platform, editor.revision, editor.publishedRevision),
    { status: 409 },
  );
  console.log(
    "PASS: draft isolation, atomic publishing, stale-version conflicts and platform-only writes",
  );
  const plan = await prisma.subscriptionPlan.create({
    data: {
      name: `展示套餐 ${stamp}`,
      description: "owned fixture",
      priceCents: 8800,
      durationDays: 30,
      maxAgents: 5,
      maxSites: 3,
      monthlyConversations: 3000,
      storageMB: 1024,
      active: true,
    },
  });
  planIds.push(plan.id);
  const withPlan = { ...draft, planIds: [plan.id] };
  assert.equal((await home.getPublicHomePlans(withPlan)).length, 1);
  await prisma.subscriptionPlan.update({
    where: { id: plan.id },
    data: { active: false },
  });
  assert.equal((await home.getPublicHomePlans(withPlan)).length, 0);
  editor = await home.getHomeEditor();
  const revision = await home.saveHomeDraft(
    platform,
    withPlan,
    editor.revision,
  );
  await assert.rejects(
    home.publishHome(platform, revision, editor.publishedRevision),
    { status: 400 },
  );
  console.log(
    "PASS: explicit public-plan selection and immediate removal of unpublished offers",
  );
  assert.match(await loginDestination(a), /\/onboarding$/);
  const site = await prisma.site.create({
    data: {
      tenantId: a.tenantId,
      name: "验收站点",
      slug: `growth-db-site-${stamp}`,
    },
  });
  assert.doesNotMatch(await loginDestination(a), /\/onboarding$/);
  await recordSiteEmbed(site.id, {
    origin: "https://shop.example.test",
    preview: true,
    embedded: true,
  });
  assert.equal(
    (await prisma.site.findUniqueOrThrow({ where: { id: site.id } }))
      .embedSeenAt,
    null,
  );
  await recordSiteEmbed(site.id, {
    origin: "https://shop.example.test",
    preview: false,
    embedded: true,
  });
  assert.equal((await getOnboarding(a.tenantId)).embedded, true);
  assert.equal((await getOnboarding(b.tenantId)).embedded, false);
  const laterSite = await prisma.site.create({
    data: {
      tenantId: a.tenantId,
      name: "另一个站点",
      slug: `growth-db-site-other-${stamp}`,
    },
  });
  const visitor = await prisma.visitor.create({
    data: { siteId: laterSite.id, localKey: stamp, email: "test@example.test" },
  });
  await prisma.conversation.create({
    data: {
      siteId: laterSite.id,
      visitorId: visitor.id,
      messages: { create: { sender: "VISITOR", type: "TEXT", body: "hello" } },
    },
  });
  const progress = await getOnboarding(a.tenantId);
  assert.equal(
    progress.sites.find((row) => row.id === site.id).hasConversation,
    false,
  );
  assert.equal(
    progress.sites.find((row) => row.id === laterSite.id).hasConversation,
    true,
  );
  assert.equal(progress.complete, false);
  console.log(
    "PASS: real installation detection excludes previews and tracks each merchant/site independently",
  );
  await prisma.setting.upsert({
    where: { key: REMINDER_SETTING_KEY },
    create: {
      key: REMINDER_SETTING_KEY,
      value: {
        revision: stamp,
        settings: { enabled: true, mailEnabled: false, leadDays: 7 },
      },
    },
    update: {
      value: {
        revision: stamp,
        settings: { enabled: true, mailEnabled: false, leadDays: 7 },
      },
    },
  });
  const second = await prisma.user.create({
    data: {
      tenantId: a.tenantId,
      email: `growth-${stamp}-second@test.local`,
      name: "第二管理员",
      role: "MERCHANT_ADMIN",
      passwordHash: "unused",
    },
  });
  await Promise.all(
    Array.from({ length: 6 }, () =>
      generateExpiryNotices(new Date(), undefined, tenantIds),
    ),
  );
  assert.equal(
    await prisma.accountNotice.count({
      where: { tenantId: { in: tenantIds } },
    }),
    3,
  );
  const own = await tenantDb(a).accountNotice.findMany();
  assert.equal(own.length, 1);
  assert.equal(own[0].userId, a.id);
  const foreign = await prisma.accountNotice.findFirstOrThrow({
    where: { userId: b.id },
  });
  const sameTenantOther = await prisma.accountNotice.findFirstOrThrow({
    where: { userId: second.id },
  });
  assert.equal(
    await tenantDb(a).accountNotice.findUnique({ where: { id: foreign.id } }),
    null,
  );
  assert.equal(
    await tenantDb(a).accountNotice.findUnique({
      where: { id: sameTenantOther.id },
    }),
    null,
  );
  await assert.rejects(
    tenantDb(a).accountNotice.update({
      where: { id: own[0].id },
      data: { readAt: new Date() },
    }),
    { status: 403 },
  );
  await prisma.tenant.update({
    where: { id: a.tenantId },
    data: { expiresAt: new Date(Date.now() + 30 * 86400000) },
  });
  assert.equal(
    await prisma.accountNotice.count({ where: await visibleNoticeWhere(a) }),
    0,
  );
  await prisma.tenant.update({
    where: { id: b.tenantId },
    data: { status: "SUSPENDED", expiresAt: new Date(Date.now() - 86400000) },
  });
  await generateExpiryNotices(new Date(), undefined, tenantIds);
  assert.equal(
    await prisma.accountNotice.count({ where: { userId: b.id } }),
    1,
  );
  const fixtureNotices = await prisma.accountNotice.findMany({
    where: { tenantId: { in: tenantIds } },
  });
  assert.ok(fixtureNotices.every((notice) => notice.mailJobId === null));
  assert.equal(
    await prisma.notificationJob.count({
      where: {
        kind: "SUBSCRIPTION_MAIL",
        OR: fixtureNotices.map((notice) => ({
          payload: { path: ["noticeId"], equals: notice.id },
        })),
      },
    }),
    0,
  );
  console.log(
    "PASS: concurrent expiry notice deduplication, per-account privacy, renewal invalidation and suspended-merchant exclusion",
  );
  const futureNow = new Date(Date.now() + 90 * 86400000),
    futureExpiry = new Date(futureNow.getTime() + 2 * 86400000);
  await prisma.tenant.updateMany({
    where: { id: { in: tenantIds } },
    data: { status: "ACTIVE", expiresAt: futureExpiry },
  });
  const reminderRules = await import("../src/lib/subscription-reminders.ts");
  const isolatedMailer = loadModule(
    "src/server/services/subscription-reminders.ts",
    {
      "../../lib/db": {
        prisma: {
          setting: {
            findUnique: async () => ({
              value: {
                revision: stamp,
                settings: { enabled: true, mailEnabled: true, leadDays: 7 },
              },
            }),
          },
          tenant: prisma.tenant,
          $transaction: prisma.$transaction.bind(prisma),
        },
      },
      "../../lib/mail": {
        getSmtpConfig: async () => ({ host: "test.invalid" }),
        sendMail: async () => {
          throw new Error("This test must never send mail");
        },
      },
      "../../lib/env": { env: { APP_URL: "https://example.test" } },
      "../../lib/app-paths": { ADMIN_PATH: "/console-test" },
      "../../lib/subscription-reminders": reminderRules,
    },
  );
  await Promise.all(
    Array.from({ length: 6 }, () =>
      isolatedMailer.generateExpiryNotices(futureNow, undefined, tenantIds),
    ),
  );
  const queuedNotices = await prisma.accountNotice.findMany({
    where: { tenantId: { in: tenantIds }, expirySnapshot: futureExpiry },
  });
  assert.equal(queuedNotices.length, 3);
  assert.ok(queuedNotices.every((notice) => notice.mailJobId));
  const jobs = await prisma.notificationJob.findMany({
    where: { id: { in: queuedNotices.map((notice) => notice.mailJobId) } },
  });
  assert.equal(jobs.length, 3);
  assert.ok(
    jobs.every(
      (job) => job.kind === "SUBSCRIPTION_MAIL" && job.availableAt >= futureNow,
    ),
  );
  console.log(
    "PASS: expiry mail jobs are atomic and deduplicated with future delivery dates; no real mail sent",
  );
} finally {
  const notices = await prisma.accountNotice.findMany({
    where: { tenantId: { in: tenantIds } },
    select: { mailJobId: true },
  });
  await prisma.notificationJob.deleteMany({
    where: {
      id: {
        in: notices.flatMap((row) => (row.mailJobId ? [row.mailJobId] : [])),
      },
    },
  });
  await prisma.site.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.accountNotice.deleteMany({
    where: { tenantId: { in: tenantIds } },
  });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { tenantId: { in: tenantIds } },
        ...(platform ? [{ actorId: platform.id }] : []),
      ],
    },
  });
  await prisma.user.deleteMany({
    where: { OR: [{ tenantId: { in: tenantIds } }, { id: { in: userIds } }] },
  });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.subscriptionPlan.deleteMany({ where: { id: { in: planIds } } });
  for (let i = 0; i < keys.length; i++)
    await restoreSetting(prisma, keys[i], saved[i]);
  await prisma.$disconnect();
  console.log("Owned growth fixtures removed; platform settings restored");
}
