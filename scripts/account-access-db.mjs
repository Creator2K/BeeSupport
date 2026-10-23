import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { useTestDatabase } from "./test-environment.mjs";
import { loadModule, HttpError } from "../tests/load-module.mjs";
import {
  accountService,
  accountMail,
  accountLinks as links,
  accountSecret,
  accountValidation,
} from "../tests/account-fixtures.mjs";
useTestDatabase();
const { prisma: db } = await import("../src/lib/db.ts");
const { assertTenantQuota } = await import("../src/server/services/tenants.ts");
const { signSessionToken, resolveUserFromToken } =
  await import("../src/lib/auth.ts");
const { tenantDb } = await import("../src/lib/tenant-db.ts");
const { recordAudit } = await import("../src/lib/audit.ts");
const stamp = randomUUID().slice(0, 12),
  tenantIds = [],
  jobIds = [],
  revoked = [],
  password = `Test-${stamp}!`;
// The application worker must never claim the test's synthetic messages.
const delayed = new Proxy(db, {
  get(target, property) {
    if (property !== "$transaction") return Reflect.get(target, property);
    return (run) =>
      db.$transaction((tx) =>
        run(
          new Proxy(tx, {
            get(inner, key) {
              if (key !== "notificationJob") return Reflect.get(inner, key);
              return {
                create: async (args) => {
                  const row = await tx.notificationJob.create({
                    ...args,
                    data: {
                      ...args.data,
                      availableAt: new Date("2100-01-01T00:00:00Z"),
                    },
                  });
                  jobIds.push(row.id);
                  return row;
                },
              };
            },
          }),
        ),
      );
  },
});
const service = accountService(delayed, {
  quota: assertTenantQuota,
  revoke: (id) => revoked.push(id),
});
let a, b, siteA, siteB;
async function queuedToken(id) {
  const job = await db.notificationJob.findFirstOrThrow({
    where: { id: { in: jobIds }, payload: { path: ["tokenId"], equals: id } },
  });
  return {
    job,
    raw: links.openAccountToken(job.payload.encrypted, accountSecret),
  };
}
async function latest(userId, purpose) {
  const row = await db.accountToken.findFirstOrThrow({
    where: { userId, purpose },
    orderBy: { createdAt: "desc" },
  });
  return { row, ...(await queuedToken(row.id)) };
}
try {
  for (const suffix of ["a", "b"]) {
    const tenant = await db.tenant.create({
      data: {
        name: `账号验收 ${stamp} ${suffix}`,
        slug: `account-db-${stamp}-${suffix}`,
        maxAgents: 2,
        users: {
          create: {
            email: `account-${stamp}-${suffix}@test.local`,
            name: "验收管理员",
            role: "MERCHANT_ADMIN",
            passwordHash: await bcrypt.hash(password, 10),
          },
        },
        sites: {
          create: { name: "验收站点", slug: `account-site-${stamp}-${suffix}` },
        },
      },
      include: { users: true, sites: true },
    });
    tenantIds.push(tenant.id);
    const actor = { ...tenant.users[0], siteIds: [tenant.sites[0].id] };
    if (suffix === "a") {
      a = actor;
      siteA = tenant.sites[0];
    } else {
      b = actor;
      siteB = tenant.sites[0];
    }
  }
  const jwt = await signSessionToken({
    userId: a.id,
    role: a.role,
    tokenVersion: a.tokenVersion,
  });
  assert.equal((await resolveUserFromToken(jwt)).id, a.id);
  await service.requestAccountMail("RESET", a.email, `test-${stamp}`);
  const reset = await latest(a.id, "RESET");
  assert.equal(reset.row.tokenHash, links.accountTokenHash(reset.raw));
  assert.equal(JSON.stringify(reset.job.payload).includes(reset.raw), false);
  assert.equal(
    reset.row.expiresAt.getTime() - reset.row.createdAt.getTime() <=
      30 * 60000 + 2000,
    true,
  );
  await assert.rejects(service.consumeAccountToken(reset.raw, "VERIFY"), {
    status: 400,
  });
  assert.equal(
    (await db.accountToken.findUniqueOrThrow({ where: { id: reset.row.id } }))
      .usedAt,
    null,
  );
  await service.requestAccountMail("RESET", a.email, `test-${stamp}`);
  const other = await latest(a.id, "RESET");
  const resetRace = await Promise.allSettled([
    service.consumeAccountToken(reset.raw, "RESET", `${password}-new`),
    service.consumeAccountToken(reset.raw, "RESET", `${password}-new`),
  ]);
  assert.equal(resetRace.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await resolveUserFromToken(jwt), null);
  assert.deepEqual(revoked, [a.id]);
  assert.equal(
    await bcrypt.compare(
      `${password}-new`,
      (await db.user.findUniqueOrThrow({ where: { id: a.id } })).passwordHash,
    ),
    true,
  );
  await assert.rejects(
    service.consumeAccountToken(other.raw, "RESET", password),
    { status: 400 },
  );
  console.log(
    "PASS: single-use password recovery, concurrent consumption, credential purpose and session invalidation",
  );

  await db.user.update({
    where: { id: b.id },
    data: { emailVerificationRequired: true },
  });
  const pendingJwt = await signSessionToken({
    userId: b.id,
    role: b.role,
    tokenVersion: 0,
  });
  assert.equal(await resolveUserFromToken(pendingJwt), null);
  await service.requestAccountMail("VERIFY", b.email, `test-${stamp}`);
  const verification = await latest(b.id, "VERIFY");
  const mailSent = [];
  const mail = accountMail(db, async (input) => {
    mailSent.push(input);
    return { ok: true };
  });
  const worker = loadModule("src/server/notification-worker.ts", {
    "../lib/db": { prisma: db },
    "../lib/mail": {},
    "../lib/webhooks": {},
    "./services/subscription-reminders": {},
    "./services/account-mail": mail,
  });
  const leased = await db.notificationJob.update({
    where: { id: verification.job.id },
    data: {
      status: "PROCESSING",
      leaseToken: stamp,
      lockedUntil: new Date(Date.now() + 300000),
      attempts: 1,
    },
  });
  await worker.deliverNotification(leased);
  assert.equal(mailSent.length, 1);
  assert.ok(
    mailSent[0].text.includes(`/verify-email#token=${verification.raw}`),
  );
  assert.deepEqual(
    (await db.notificationJob.findUniqueOrThrow({ where: { id: leased.id } }))
      .payload,
    {},
  );
  assert.equal(
    (
      await db.accountToken.findUniqueOrThrow({
        where: { id: verification.row.id },
      })
    ).usedAt,
    null,
  );
  await service.consumeAccountToken(verification.raw, "VERIFY");
  assert.equal((await resolveUserFromToken(pendingJwt)).id, b.id);
  await assert.rejects(
    service.consumeAccountToken(verification.raw, "VERIFY"),
    { status: 400 },
  );
  await service.requestAccountMail("RESET", b.email, `test-${stamp}`);
  const expired = await latest(b.id, "RESET");
  await db.accountToken.update({
    where: { id: expired.row.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await assert.rejects(
    service.consumeAccountToken(expired.raw, "RESET", password),
    { status: 400 },
  );
  assert.equal(
    (await mail.deliverAccountMail(expired.job.payload, expired.job.id))
      .skipped,
    true,
  );
  console.log(
    "PASS: email verification is explicit, expiring, single-use; outbox encrypts and clears credentials",
  );

  const manual = await db.user.create({
    data: {
      tenantId: b.tenantId,
      email: `manual-${stamp}@test.local`,
      name: "手动找回验收",
      passwordHash: "unused",
      emailVerificationRequired: true,
    },
  });
  const agentActions = loadModule("src/server/actions/agents.ts", {
    zod: { z },
    "next/cache": { revalidatePath: () => {} },
    "@/lib/auth": {
      HttpError,
      hashPassword: (value) => bcrypt.hash(value, 10),
      requireAdmin: async () => b,
    },
    "@/lib/audit": { recordAudit },
    "@/lib/tenant-db": { adminDb: async () => tenantDb(b), tenantDb },
    "@/lib/realtime/emit": { revokeAgentConnections: (id) => revoked.push(id) },
    "@/server/services/tenants": { assertTenantQuota },
    "@/lib/validation": accountValidation,
    "./result": {
      toActionResult: (error) => {
        throw error;
      },
    },
  });
  assert.equal(
    (
      await agentActions.resetAgentPasswordAction(
        manual.id,
        `${password}-manual`,
      )
    ).ok,
    true,
  );
  const recovered = await db.user.findUniqueOrThrow({
    where: { id: manual.id },
  });
  assert.equal(recovered.emailVerificationRequired, false);
  assert.equal(recovered.emailVerifiedAt, null);
  assert.equal(recovered.tokenVersion, 1);
  assert.equal(
    await bcrypt.compare(`${password}-manual`, recovered.passwordHash),
    true,
  );
  const recoveredJwt = await signSessionToken({
    userId: manual.id,
    role: "AGENT",
    tokenVersion: 1,
  });
  assert.equal((await resolveUserFromToken(recoveredJwt)).id, manual.id);
  console.log(
    "PASS: existing administrator reset remains available and clears the verification gate without claiming email ownership",
  );

  const email = `invite-${stamp}@test.local`;
  await assert.rejects(service.createInvitation(a, { email, role: "ADMIN" }));
  await assert.rejects(
    service.createInvitation({ ...a, role: "AGENT" }, { email }),
    { status: 403 },
  );
  await assert.rejects(
    service.createInvitation(a, { email, siteIds: [siteB.id] }),
    { status: 403 },
  );
  const invite = await service.createInvitation(a, {
    email,
    siteIds: [siteA.id],
  });
  const first = await queuedToken(invite);
  await assert.rejects(service.revokeInvitation(b, invite), { status: 404 });
  assert.equal(
    (await service.listInvitations(b)).some((r) => r.id === invite),
    false,
  );
  assert.equal("tokenHash" in (await service.listInvitations(a))[0], false);
  const resentId = await service.createInvitation(
    a,
    { email, siteIds: [siteA.id] },
    invite,
  );
  const resent = await queuedToken(resentId);
  await assert.rejects(
    service.acceptInvitation(first.raw, "旧邀请", password),
    { status: 400 },
  );
  assert.equal(
    (await mail.deliverAccountMail(first.job.payload, first.job.id)).skipped,
    true,
  );
  await service.revokeInvitation(a, resentId);
  await assert.rejects(
    service.acceptInvitation(resent.raw, "撤销邀请", password),
    { status: 400 },
  );
  console.log(
    "PASS: invitation isolation, role/site boundaries, resend invalidation and cancellation",
  );

  const protectedId = await service.createInvitation(a, {
    email: `protected-${stamp}@test.local`,
    siteIds: [siteA.id],
  });
  const protectedToken = await queuedToken(protectedId);
  await db.user.update({ where: { id: a.id }, data: { active: false } });
  await assert.rejects(
    service.acceptInvitation(protectedToken.raw, "权限失效", password),
    { status: 403 },
  );
  await db.user.update({ where: { id: a.id }, data: { active: true } });
  await db.tenant.update({
    where: { id: a.tenantId },
    data: { status: "SUSPENDED" },
  });
  await assert.rejects(
    service.acceptInvitation(protectedToken.raw, "停用团队", password),
    { status: 403 },
  );
  await db.tenant.update({
    where: { id: a.tenantId },
    data: { status: "ACTIVE", expiresAt: new Date(Date.now() - 1000) },
  });
  await assert.rejects(
    service.acceptInvitation(protectedToken.raw, "到期团队", password),
    { status: 403 },
  );
  await db.tenant.update({
    where: { id: a.tenantId },
    data: { expiresAt: null },
  });
  await db.site.update({
    where: { id: siteA.id },
    data: { tenantId: b.tenantId },
  });
  await assert.rejects(
    service.acceptInvitation(protectedToken.raw, "站点变更", password),
    { status: 400 },
  );
  await db.site.update({
    where: { id: siteA.id },
    data: { tenantId: a.tenantId },
  });
  assert.equal(
    (await db.accountToken.findUniqueOrThrow({ where: { id: protectedId } }))
      .usedAt,
    null,
  );
  await service.revokeInvitation(a, protectedId);
  const oneId = await service.createInvitation(a, {
    email: `race-one-${stamp}@test.local`,
    role: "AGENT",
    siteIds: [siteA.id],
  });
  const twoId = await service.createInvitation(a, {
    email: `race-two-${stamp}@test.local`,
    role: "MERCHANT_ADMIN",
  });
  const one = await queuedToken(oneId),
    two = await queuedToken(twoId);
  const race = await Promise.allSettled([
    service.acceptInvitation(one.raw, "成员一", password),
    service.acceptInvitation(two.raw, "成员二", password),
  ]);
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(race.find((r) => r.status === "rejected").reason.status, 403);
  assert.equal(
    await db.user.count({ where: { tenantId: a.tenantId, active: true } }),
    2,
  );
  const winner = await db.user.findFirstOrThrow({
    where: { tenantId: a.tenantId, id: { not: a.id } },
    include: { sites: true },
  });
  assert.ok(winner.emailVerifiedAt);
  assert.ok(["AGENT", "MERCHANT_ADMIN"].includes(winner.role));
  assert.deepEqual(
    winner.sites.map((s) => s.siteId),
    winner.role === "AGENT" ? [siteA.id] : [],
  );
  assert.equal(
    await db.accountToken.count({
      where: { id: { in: [oneId, twoId] }, usedAt: { not: null } },
    }),
    1,
  );
  console.log(
    "PASS: acceptance rechecks issuer/status/expiry/sites and concurrent joins cannot exceed quota",
  );
  console.log("Account-access database validation: 5 groups passed");
} finally {
  await db.notificationJob.deleteMany({ where: { id: { in: jobIds } } });
  await db.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await db.site.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await db.user.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await db.$disconnect();
}
