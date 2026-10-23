import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deliveryPolicy as policy,
  deliveryService,
} from "./delivery-fixtures.mjs";
import { loadModule } from "./load-module.mjs";

test("delivery states distinguish successful transport, skipped work and historical completions", () => {
  for (const [outcome, expected] of [
    ["SUCCESS", "SUCCESS"],
    ["SKIPPED", "SKIPPED"],
    [null, "LEGACY"],
  ])
    assert.equal(
      policy.deliveryState({ status: "DELIVERED", outcome }),
      expected,
    );
  assert.equal(
    policy.deliveryState({ status: "FAILED", outcome: null }),
    "FAILED",
  );
  assert.equal(
    policy.deliveryState({ status: "corrupt", outcome: null }),
    "UNKNOWN",
  );
});
test("notification diagnostics never expose raw errors, endpoint URLs, addresses or credentials", () => {
  for (const raw of [
    "535 SMTP auth password=smtp-secret",
    "ETIMEDOUT https://user:password@host/private?token=secret",
    "malicious <script>password-secret</script>",
    "failed to decrypt token=secret",
    null,
  ]) {
    const safe = policy.deliveryDiagnostic(raw, "FAILED");
    for (const value of [
      "password-secret",
      "smtp-secret",
      "https://",
      "token=secret",
      "<script>",
    ])
      assert.equal(safe.includes(value), false);
  }
});
test("merchants and agents cannot list or retry platform delivery records", async () => {
  const service = deliveryService(
    new Proxy(
      {},
      {
        get() {
          throw Error("Unauthorized request reached database");
        },
      },
    ),
  );
  for (const role of ["AGENT", "MERCHANT_ADMIN"]) {
    await assert.rejects(service.getDeliveries({ role }, {}), { status: 403 });
    await assert.rejects(service.retryDelivery({ role }, {}), { status: 403 });
  }
});
test("retry rejects malformed versions and rate limits before changing queue state", async () => {
  const service = deliveryService(
    new Proxy(
      {},
      {
        get() {
          throw Error("Rejected retry reached database");
        },
      },
    ),
    { rateLimit: async () => ({ ok: false }) },
  );
  await assert.rejects(
    service.retryDelivery(
      { role: "ADMIN" },
      { id: "job", updatedAt: "bad", manualRetries: 0 },
    ),
  );
  await assert.rejects(
    service.retryDelivery(
      { role: "ADMIN" },
      { id: "job", updatedAt: new Date().toISOString(), manualRetries: 0 },
    ),
    { status: 429 },
  );
});
test("worker records skipped deliveries separately and scrubs completed account credentials", async () => {
  let saved;
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
      deliverAccountMail: async () => ({ ok: false, skipped: true }),
    },
  });
  await worker.deliverNotification({
    id: "j",
    kind: "ACCOUNT_MAIL",
    leaseToken: "lease",
    attempts: 1,
    payload: {},
  });
  assert.equal(saved.status, "DELIVERED");
  assert.equal(saved.outcome, "SKIPPED");
  assert.deepEqual(saved.payload, {});
});

test("missing SMTP leaves conversation mail retryable instead of marking an unsent message complete", async () => {
  let saved;
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
    "../lib/mail": { sendMail: async () => ({ ok: false, skipped: true }) },
    "../lib/webhooks": {},
    "./services/subscription-reminders": {},
    "./services/account-mail": {},
  });
  await worker.deliverNotification({
    id: "mail",
    kind: "MAIL",
    leaseToken: "lease",
    attempts: 1,
    payload: {},
  });
  assert.equal(saved.status, "PENDING");
  assert.equal(saved.outcome, null);
  await worker.deliverNotification({
    id: "mail",
    kind: "MAIL",
    leaseToken: "lease",
    attempts: 5,
    payload: {},
  });
  assert.equal(saved.status, "FAILED");
});
