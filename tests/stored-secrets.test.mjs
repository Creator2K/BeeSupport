import assert from "node:assert/strict";
import test from "node:test";
import { z, ZodError } from "zod";

import { HttpError, loadAiModule, loadModule } from "./load-module.mjs";

const admin = { id: "admin", name: "Admin", role: "ADMIN" };
const auth = {
  HttpError,
  requireAdmin: async () => admin,
  requirePlatformAdmin: async () => admin,
};
const shared = {
  "next/cache": { revalidatePath() {} },
  zod: { z },
  "@/lib/auth": auth,
  "@/lib/audit": { recordAudit: async () => {} },
  "./result": loadModule("src/server/actions/result.ts", {
    zod: { ZodError },
    "@/lib/auth": auth,
  }),
};

function settingStore(initial) {
  const rows = new Map(Object.entries(initial));
  return {
    rows,
    setting: {
      findUnique: async ({ where }) =>
        rows.has(where.key)
          ? { key: where.key, value: rows.get(where.key) }
          : null,
      upsert: async ({ where, create }) => {
        rows.set(where.key, create.value);
      },
    },
  };
}

test("a blank SMTP password keeps the stored one only for the same server and account", async () => {
  const db = settingStore({
    smtp: {
      host: "smtp.example.com",
      port: 465,
      secure: true,
      user: "bot",
      pass: "stored-pass",
      from: "",
    },
  });
  const actions = loadModule("src/server/actions/settings.ts", {
    ...shared,
    "@/lib/db": { prisma: db },
    "@/lib/mail": {
      SMTP_SETTING_KEY: "smtp",
      sendMail: async () => ({ ok: true }),
      verifySmtp: async () => ({ ok: true }),
    },
  });
  const form = {
    host: "smtp.example.com",
    port: 465,
    secure: true,
    user: "bot",
    pass: "",
    from: "",
  };

  const kept = await actions.saveSmtpAction({ ...form, from: "a@example.com" });
  assert.equal(kept.ok, true);
  assert.equal(db.rows.get("smtp").pass, "stored-pass");
  assert.equal(db.rows.get("smtp").from, "a@example.com");

  const movedHost = await actions.saveSmtpAction({
    ...form,
    host: "smtp.other.example",
  });
  assert.equal(movedHost.ok, false);
  assert.match(movedHost.error, /重新填写密码/);
  const movedUser = await actions.testSmtpAction({ ...form, user: "other" });
  assert.equal(movedUser.ok, false);
  assert.match(movedUser.error, /重新填写密码/);
  assert.equal(db.rows.get("smtp").host, "smtp.example.com");
  assert.equal(db.rows.get("smtp").user, "bot");

  const replaced = await actions.saveSmtpAction({
    ...form,
    host: "smtp.other.example",
    pass: "new-pass",
  });
  assert.equal(replaced.ok, true);
  assert.equal(db.rows.get("smtp").host, "smtp.other.example");
  assert.equal(db.rows.get("smtp").pass, "new-pass");

  const anonymous = await actions.saveSmtpAction({
    ...form,
    host: "smtp.other.example",
    user: "",
  });
  assert.equal(anonymous.ok, true);
  assert.equal(db.rows.get("smtp").pass, "");
});

test("a blank AI key keeps the stored one only for the endpoint it was saved for", async () => {
  const db = settingStore({
    ai: { baseUrl: "https://ai.example.com/v1/", apiKey: "stored-key" },
  });
  const listed = [];
  const tested = [];
  const ai = {
    ...loadAiModule(db),
    listAiModels: async (input) => {
      listed.push(input);
      return ["m1"];
    },
  };
  const actions = loadModule("src/server/actions/ai-settings.ts", {
    ...shared,
    "@/lib/ai": ai,
    "@/lib/db": { prisma: db },
    "@/server/services/ai": {
      testAiConnection: async ({ config }) => {
        tested.push(config);
        return { model: config.model, text: "pong" };
      },
    },
    "./ai-schemas": loadModule("src/server/actions/ai-schemas.ts", {
      zod: { z },
      "@/lib/ai": ai,
    }),
  });
  const form = {
    enabled: true,
    baseUrl: "https://ai.example.com",
    apiKey: "",
    model: "m1",
    models: ["m1"],
    assistantName: "Bot",
    systemPrompt: "Be brief",
    autoReply: "off",
    temperature: 0.3,
    maxTokens: 600,
    topK: 4,
    historyLimit: 12,
  };
  const elsewhere = "https://ai.other.example/v1";

  assert.deepEqual(
    await actions.listAiModelsAction({ baseUrl: form.baseUrl, apiKey: "" }),
    { ok: true, models: ["m1"] },
  );
  assert.equal(listed[0].apiKey, "stored-key");
  const listedElsewhere = await actions.listAiModelsAction({
    baseUrl: elsewhere,
    apiKey: "",
  });
  assert.equal(listedElsewhere.ok, false);
  assert.match(listedElsewhere.error, /重新填写 API Key/);
  assert.equal(listed.length, 1);

  assert.equal((await actions.testAiAction({ ...form, prompt: "ping" })).ok, true);
  assert.equal(tested[0].apiKey, "stored-key");
  const testedElsewhere = await actions.testAiAction({
    ...form,
    baseUrl: elsewhere,
    prompt: "ping",
  });
  assert.equal(testedElsewhere.ok, false);
  assert.match(testedElsewhere.error, /重新填写 API Key/);
  assert.equal(tested.length, 1);

  const movedSave = await actions.saveAiSettingsAction({
    ...form,
    baseUrl: elsewhere,
  });
  assert.equal(movedSave.ok, false);
  assert.match(movedSave.error, /重新填写 API Key/);
  assert.equal(db.rows.get("ai").baseUrl, "https://ai.example.com/v1/");

  assert.equal((await actions.saveAiSettingsAction(form)).ok, true);
  assert.equal(db.rows.get("ai").apiKey, "stored-key");
  assert.equal(db.rows.get("ai").assistantName, "Bot");

  const replaced = await actions.saveAiSettingsAction({
    ...form,
    baseUrl: elsewhere,
    apiKey: "new-key",
  });
  assert.equal(replaced.ok, true);
  assert.equal(db.rows.get("ai").baseUrl, elsewhere);
  assert.equal(db.rows.get("ai").apiKey, "new-key");
});

test("a blank webhook secret is kept for the same channel type and never moved to another bearer target", async () => {
  const rows = new Map([
    [
      "generic",
      {
        id: "generic",
        tenantId: "legacy",
        type: "GENERIC",
        url: "https://hooks.example.com/a",
        secret: "signing-secret",
      },
    ],
    [
      "bridge",
      {
        id: "bridge",
        tenantId: "legacy",
        type: "WECHAT",
        url: "http://127.0.0.1:3900/send",
        secret: "bridge-token",
      },
    ],
  ]);
  const sent = [];
  const site = { id: "site-1", name: "Site" };
  const actions = loadModule("src/server/actions/webhooks.ts", {
    ...shared,
    "@/server/services/tenants": { resourceTenantId: async () => "legacy" },
    "@/lib/tenant-db": {
      adminDb: async () => ({
        webhookEndpoint: {
          findUnique: async ({ where }) => rows.get(where.id) ?? null,
          update: async ({ where, data }) => {
            Object.assign(rows.get(where.id), data);
          },
        },
        site: { findFirst: async () => site, findUnique: async () => site },
      }),
    },
    "@/lib/public-webhook": { publicWebhookTarget: async () => {} },
    "@/lib/webhooks": {
      testWebhook: async (...args) => {
        sent.push(args);
        return { ok: true };
      },
    },
  });
  const generic = {
    name: "Generic",
    type: "GENERIC",
    url: "https://hooks.example.com/b",
    secret: null,
    events: [],
    siteId: null,
    active: true,
  };
  const bridge = {
    ...generic,
    name: "Bridge",
    type: "WECHAT",
    url: "http://127.0.0.1:3900/send",
  };

  assert.equal((await actions.updateWebhookAction("generic", generic)).ok, true);
  assert.equal(rows.get("generic").url, "https://hooks.example.com/b");
  assert.equal(rows.get("generic").secret, "signing-secret");

  assert.equal(
    (
      await actions.updateWebhookAction("generic", {
        ...generic,
        clearSecret: true,
      })
    ).ok,
    true,
  );
  assert.equal(rows.get("generic").secret, null);

  await actions.updateWebhookAction("generic", { ...generic, secret: "next" });
  assert.equal(rows.get("generic").secret, "next");
  await actions.updateWebhookAction("generic", {
    ...generic,
    type: "WECHAT_WORK",
  });
  assert.equal(rows.get("generic").type, "WECHAT_WORK");
  assert.equal(rows.get("generic").secret, null);

  assert.equal((await actions.updateWebhookAction("bridge", bridge)).ok, true);
  assert.equal(rows.get("bridge").secret, "bridge-token");
  const moved = await actions.updateWebhookAction("bridge", {
    ...bridge,
    url: "https://bridge.other.example/send",
  });
  assert.equal(moved.ok, false);
  assert.match(moved.error, /重新填写密钥/);
  assert.equal(rows.get("bridge").url, "http://127.0.0.1:3900/send");

  const target = { type: "WECHAT", url: "http://127.0.0.1:3900/send" };
  await actions.testWebhookAction({ id: "bridge", ...target });
  await actions.testWebhookAction({
    id: "bridge",
    type: "WECHAT",
    url: "https://bridge.other.example/send",
  });
  await actions.testWebhookAction(target);
  assert.deepEqual(
    sent.map(([, url, secret]) => [url, secret]),
    [
      ["http://127.0.0.1:3900/send", "bridge-token"],
      ["https://bridge.other.example/send", null],
      ["http://127.0.0.1:3900/send", null],
    ],
  );
});
