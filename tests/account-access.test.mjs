import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { loadModule } from "./load-module.mjs";
import { HttpError } from "./load-module.mjs";
import {
  accountLinks as links,
  accountSecret,
  accountService,
  accountMail,
} from "./account-fixtures.mjs";

test("account credentials use random digests and authenticated encryption with independent nonces", () => {
  const raw = links.newAccountToken(),
    other = links.newAccountToken();
  assert.match(raw, links.ACCOUNT_TOKEN_PATTERN);
  assert.notEqual(raw, other);
  assert.notEqual(raw, links.accountTokenHash(raw));
  const sealed = links.sealAccountToken(raw, accountSecret);
  assert.notEqual(sealed, links.sealAccountToken(raw, accountSecret));
  assert.equal(sealed.includes(raw), false);
  assert.equal(links.openAccountToken(sealed, accountSecret), raw);
  assert.throws(() => links.openAccountToken(sealed, "different secret"));
  const tampered = Buffer.from(sealed, "base64url");
  tampered[30] ^= 1;
  assert.throws(() =>
    links.openAccountToken(tampered.toString("base64url"), accountSecret),
  );
  assert.throws(() => links.openAccountToken("bad", accountSecret));
});

test("mail requests do not disclose account existence, disabled state or missing SMTP and honor per-email limits", async () => {
  let reads = 0,
    writes = 0;
  const db = {
    $transaction: (f) => f(db),
    user: {
      findUnique: async () => {
        reads++;
        return null;
      },
    },
    accountToken: {
      create: async () => {
        writes++;
      },
    },
  };
  const unavailable = accountService(db, { smtp: async () => null });
  assert.equal(
    await unavailable.requestAccountMail("RESET", "Absent@example.com", "ip"),
    undefined,
  );
  assert.equal(reads, 0);
  assert.equal(
    await accountService(db).requestAccountMail(
      "RESET",
      "absent@example.com",
      "ip",
    ),
    undefined,
  );
  assert.equal(reads, 1);
  db.user.findUnique = async () => ({ active: false });
  assert.equal(
    await accountService(db).requestAccountMail(
      "RESET",
      "disabled@example.com",
      "ip",
    ),
    undefined,
  );
  assert.equal(writes, 0);
  const limited = accountService(db, {
    rateLimit: async () => ({ ok: false }),
  });
  db.user.findUnique = () => {
    throw Error("Rate-limited request reached database");
  };
  assert.equal(
    await limited.requestAccountMail("VERIFY", "limited@example.com", "ip"),
    undefined,
  );
});

test("credential mail validates account state and uses fragment links without consuming tokens", async () => {
  const raw = links.newAccountToken();
  let sent;
  const row = {
    id: "token",
    tokenHash: links.accountTokenHash(raw),
    purpose: "RESET",
    email: "a@example.com",
    tokenVersion: 2,
    expiresAt: new Date(Date.now() + 60000),
    user: { active: true, email: "a@example.com", tokenVersion: 2 },
    tenant: { name: "Team" },
  };
  const payload = {
    tokenId: row.id,
    encrypted: links.sealAccountToken(raw, accountSecret),
  };
  const mail = accountMail(
    { accountToken: { findUnique: async () => row } },
    async (input) => {
      sent = input;
      return { ok: true };
    },
  );
  assert.equal((await mail.deliverAccountMail(payload, "job")).ok, true);
  assert.ok(sent.text.includes(`/reset-password#token=${raw}`));
  assert.equal(sent.text.includes(`?token=`), false);
  assert.equal(sent.messageId, "<job@beesupport>");
  row.user.tokenVersion++;
  sent = null;
  assert.equal((await mail.deliverAccountMail(payload, "job")).skipped, true);
  assert.equal(sent, null);
  row.user.tokenVersion = 2;
  row.usedAt = new Date();
  assert.equal((await mail.deliverAccountMail(payload, "job")).skipped, true);
});

test("missing SMTP for credential mail remains retryable without disclosing transport errors", async () => {
  const raw = links.newAccountToken();
  const row = {
    tokenHash: links.accountTokenHash(raw),
    purpose: "VERIFY",
    email: "a@example.com",
    tokenVersion: 0,
    expiresAt: new Date(Date.now() + 60000),
    user: { active: true, email: "a@example.com", tokenVersion: 0 },
    tenant: {},
  };
  const mail = accountMail(
    { accountToken: { findUnique: async () => row } },
    async () => ({ ok: false, skipped: true, error: "SMTP password secret" }),
  );
  const result = await mail.deliverAccountMail(
    { tokenId: "t", encrypted: links.sealAccountToken(raw, accountSecret) },
    "j",
  );
  assert.equal(result.ok, false);
  assert.equal(result.skipped, undefined);
  assert.equal(JSON.stringify(result).includes("password secret"), false);
});

test("account outbox clears delivered credentials and retries temporary delivery failures", async () => {
  let saved,
    ok = false;
  const worker = loadModule("src/server/notification-worker.ts", {
    "../lib/db": {
      prisma: {
        notificationJob: {
          updateMany: async ({ data }) => {
            saved = data;
          },
        },
      },
    },
    "../lib/mail": {},
    "../lib/webhooks": {},
    "./services/subscription-reminders": {},
    "./services/account-mail": {
      deliverAccountMail: async () =>
        ok ? { ok: true } : { ok: false, error: "temporary" },
    },
  });
  const job = {
    id: "j",
    kind: "ACCOUNT_MAIL",
    attempts: 1,
    leaseToken: "lease",
    payload: {},
  };
  await worker.deliverNotification(job);
  assert.equal(saved.status, "PENDING");
  assert.ok(saved.availableAt > new Date());
  ok = true;
  await worker.deliverNotification(job);
  assert.equal(saved.status, "DELIVERED");
  assert.deepEqual(saved.payload, {});
});

test("account policy actions reject merchant access and prevent enabling verification without SMTP", async () => {
  let platform = false;
  const actions = loadModule("src/server/actions/account-access.ts", {
    zod: { z },
    "next/cache": { revalidatePath: () => {} },
    "@/lib/auth": {
      HttpError,
      requirePlatformAdmin: async () => {
        if (!platform) throw new HttpError(403, "需要平台管理员权限");
        return { id: "admin", tenantId: "legacy", name: "Admin" };
      },
    },
    "@/lib/db": {
      prisma: {
        $transaction: () => {
          throw Error("Rejected policy must not write to database");
        },
      },
    },
    "@/lib/app-paths": { ADMIN_PATH: "/admin" },
    "@/lib/account-links": links,
    "@/lib/mail": { getSmtpConfig: async () => null },
    "@/server/services/account-access": {},
    "./result": { toActionResult: (e) => ({ ok: false, error: e.message }) },
  });
  const merchant = await actions.saveAccountPolicyAction({
    requireEmailVerification: true,
  });
  assert.equal(merchant.ok, false);
  assert.match(merchant.error, /平台管理员/);
  platform = true;
  const missing = await actions.saveAccountPolicyAction({
    requireEmailVerification: true,
  });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /SMTP/);
});
