import { test } from "node:test";
import assert from "node:assert/strict";

import { loadAiModule, loadModule } from "./load-module.mjs";

const ai = loadAiModule();
const policy = loadModule("src/lib/ai-policy.ts");

const config = {
  ...ai.defaultAiConfig(),
  enabled: true,
  autoReply: "off",
  assistantName: "平台助手",
  systemPrompt: "平台提示词",
  enableTools: true,
};

test("tenant and site policies inherit narrowly and override explicitly", () => {
  const inherited = policy.resolveEffectiveAiPolicy(config, {
    featuresAi: true,
    tenant: null,
    site: null,
  });
  assert.equal(inherited.enabled, true);
  assert.equal(inherited.autoReply, "off");
  assert.equal(inherited.config.assistantName, "平台助手");
  assert.equal(inherited.config.enableTools, true);

  const overridden = policy.resolveEffectiveAiPolicy(config, {
    featuresAi: true,
    tenant: {
      ...policy.DEFAULT_TENANT_AI_POLICY,
      autoReply: "always",
      assistantName: "商家助手",
      systemPrompt: "商家提示词",
      allowTools: false,
      allowMutations: false,
      monthlyRequestLimit: 1000,
      monthlyTokenLimit: 100000,
      concurrencyLimit: 3,
      overLimitAction: "handoff",
    },
    site: {
      enabled: true,
      autoReply: "no_agent",
      assistantName: "站点助手",
      systemPrompt: null,
      allowTools: true,
      allowMutations: null,
      monthlyRequestLimit: 200,
      monthlyTokenLimit: 0,
      concurrencyLimit: 1,
      overLimitAction: "skip",
    },
  });
  assert.equal(overridden.autoReply, "no_agent");
  assert.equal(overridden.config.assistantName, "站点助手");
  assert.equal(overridden.config.systemPrompt, "商家提示词");
  assert.equal(overridden.config.enableTools, true);
  assert.equal(overridden.allowMutations, false);
  assert.equal(overridden.monthlyRequestLimit, 200);
  assert.equal(overridden.requestLimitScope, "site");
  assert.equal(overridden.monthlyTokenLimit, null);
  assert.equal(overridden.tokenLimitScope, "site");
  assert.equal(overridden.concurrencyLimit, 1);
  assert.equal(overridden.overLimitAction, "skip");
});

test("disabled plan, provider, merchant or site blocks AI independently", () => {
  const tenant = policy.DEFAULT_TENANT_AI_POLICY;
  assert.equal(
    policy.resolveEffectiveAiPolicy(config, {
      featuresAi: false,
      tenant,
      site: null,
    }).enabled,
    false,
  );
  assert.equal(
    policy.resolveEffectiveAiPolicy({ ...config, enabled: false }, {
      featuresAi: true,
      tenant,
      site: null,
    }).enabled,
    false,
  );
  assert.equal(
    policy.resolveEffectiveAiPolicy(config, {
      featuresAi: true,
      tenant: { ...tenant, enabled: false },
      site: null,
    }).enabled,
    false,
  );
  assert.equal(
    policy.resolveEffectiveAiPolicy(config, {
      featuresAi: true,
      tenant,
      site: {
        enabled: false,
        autoReply: null,
        assistantName: null,
        systemPrompt: null,
        allowTools: null,
        allowMutations: null,
        monthlyRequestLimit: null,
        monthlyTokenLimit: null,
        concurrencyLimit: null,
        overLimitAction: null,
      },
    }).enabled,
    false,
  );
});

test("limits are bounded and zero means unlimited where an override is explicit", () => {
  assert.equal(policy.normalizePositiveLimit(0), null);
  assert.equal(policy.normalizePositiveLimit(-3), 1);
  assert.equal(policy.normalizePositiveLimit(12.9), 12);
  assert.equal(policy.normalizePositiveLimit(100_000_001), 100_000_000);
  assert.equal(policy.normalizeConcurrency(0), 1);
  assert.equal(policy.normalizeConcurrency(20), 8);
  assert.equal(policy.normalizeConcurrency(null), 2);
});
