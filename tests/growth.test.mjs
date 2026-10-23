import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { loadModule } from "./load-module.mjs";
const defaults = loadModule("src/lib/homepage-content.ts");
const home = loadModule("src/lib/homepage-validation.ts", {
  zod: { z },
  "./homepage-content": defaults,
});
const reminder = loadModule("src/lib/subscription-reminders.ts", {
  zod: { z },
});
test("homepage documents bound editable content, reject arbitrary markup fields and preserve the initial fallback", () => {
  assert.equal(
    home.homeContentSchema.safeParse(defaults.DEFAULT_HOME_CONTENT).success,
    true,
  );
  for (const change of [
    { planIds: ["one", "one"] },
    { brandName: "x".repeat(41) },
    { faqs: [] },
    { html: "<iframe>" },
    { sections: { features: true } },
  ])
    assert.equal(
      home.homeContentSchema.safeParse({
        ...defaults.DEFAULT_HOME_CONTENT,
        ...change,
      }).success,
      false,
    );
  assert.deepEqual(home.readHomeDocument(null), {
    revision: "initial",
    content: defaults.DEFAULT_HOME_CONTENT,
  });
  const doc = {
    revision: "v1",
    content: { ...defaults.DEFAULT_HOME_CONTENT, brandName: "演示品牌" },
  };
  assert.equal(home.readHomeDocument(doc).content.brandName, "演示品牌");
});
test("expiry reminders choose one phase, include exact boundaries and stop after the grace window", () => {
  const now = new Date("2026-10-20T00:00:00Z"),
    expiry = (days) => new Date(now.getTime() + days * 86400000);
  for (const [days, lead, expected] of [
    [30, 30, 30],
    [14, 30, 14],
    [10, 14, 14],
    [8, 7, null],
    [7, 7, 7],
    [3, 7, 3],
    [1, 7, 1],
    [0, 7, 0],
    [-7, 7, 0],
    [-7.001, 30, null],
  ])
    assert.equal(reminder.reminderPhase(expiry(days), now, lead), expected);
  assert.equal(reminder.reminderPhase(null, now, 30), null);
});
test("queued expiry mail is skipped after renewal, suspension, role changes or disabling mail", async () => {
  let sent = 0;
  const expiresAt = new Date(Date.now() + 2 * 86400000);
  const notice = {
    id: "notice-1",
    kind: "subscription.expiry",
    title: "即将到期",
    body: "renew",
    tenantId: "a",
    expirySnapshot: expiresAt,
    tenant: { status: "ACTIVE", expiresAt },
    user: {
      active: true,
      role: "MERCHANT_ADMIN",
      tenantId: "a",
      email: "owner@example.test",
    },
  };
  const config = {
    revision: "v1",
    settings: { enabled: true, mailEnabled: true, leadDays: 7 },
  };
  const service = loadModule("src/server/services/subscription-reminders.ts", {
    "../../lib/db": {
      prisma: {
        setting: { findUnique: async () => ({ value: config }) },
        accountNotice: { findUnique: async () => notice },
      },
    },
    "../../lib/mail": {
      getSmtpConfig: async () => ({ host: "smtp.test" }),
      sendMail: async (input) => {
        sent++;
        assert.equal(input.to, "owner@example.test");
        assert.match(input.text, /\/console-test\/subscription/);
        return { ok: true };
      },
    },
    "../../lib/env": { env: { APP_URL: "https://example.test" } },
    "../../lib/app-paths": { ADMIN_PATH: "/console-test" },
    "../../lib/subscription-reminders": reminder,
  });
  const payload = { noticeId: notice.id, phase: 3 };
  assert.equal((await service.deliverExpiryMail(payload)).ok, true);
  assert.equal(sent, 1);
  for (const [object, key, value] of [
    [notice.tenant, "expiresAt", new Date(expiresAt.getTime() + 86400000)],
    [notice.tenant, "status", "SUSPENDED"],
    [notice.user, "active", false],
    [notice.user, "role", "AGENT"],
    [config.settings, "mailEnabled", false],
  ]) {
    const previous = object[key];
    object[key] = value;
    assert.equal((await service.deliverExpiryMail(payload)).skipped, true);
    object[key] = previous;
  }
  assert.equal(sent, 1);
  assert.equal((await service.deliverExpiryMail({})).retryable, false);
});
test("ordinary API requests and authenticated preview traffic cannot mark a site as installed", async () => {
  let writes = 0;
  const service = loadModule("src/server/services/onboarding.ts", {
    "../../lib/db": {
      prisma: {
        site: {
          updateMany: async () => {
            writes++;
            return { count: 1 };
          },
        },
      },
    },
    "../../lib/app-paths": { ADMIN_PATH: "/console-test" },
  });
  await service.recordSiteEmbed("site", {
    origin: null,
    preview: false,
    embedded: false,
  });
  await service.recordSiteEmbed("site", {
    origin: "https://example.test",
    preview: true,
    embedded: true,
  });
  await service.recordSiteEmbed("site", {
    origin: "null",
    preview: false,
    embedded: true,
  });
  await service.recordSiteEmbed("site", {
    origin: "file:///tmp/test",
    preview: false,
    embedded: true,
  });
  assert.equal(writes, 0);
  await service.recordSiteEmbed("site", {
    origin: "https://example.test",
    preview: false,
    embedded: true,
  });
  assert.equal(writes, 1);
});
