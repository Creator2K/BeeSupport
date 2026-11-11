import type { AiPolicy, AiSitePolicy } from "@prisma/client";

import { getAiConfig, type AiConfig } from "../../lib/ai";
import {
  AI_AUTO_REPLY_VALUES,
  AI_OVER_LIMIT_ACTIONS,
  DEFAULT_TENANT_AI_POLICY,
  resolveEffectiveAiPolicy,
  type AiOverLimitAction,
  type AiPolicyAutoReply,
  type AiPolicyFields,
  type AiSitePolicyFields,
  type EffectiveAiPolicy,
} from "../../lib/ai-policy";
import type { SessionUser } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { readFeatures } from "../../lib/entitlements";
import { recordAudit } from "../../lib/audit";
import { HttpError } from "../../lib/auth";
import { getAiUsageSummary, type AiUsageSummary } from "./ai-usage";

export type AiPolicyEditorValue = {
  scope: "tenant" | "site";
  siteId: string | null;
  siteName: string;
  version: number;
  enabledMode: "inherit" | "on" | "off";
  autoReply: AiPolicyAutoReply;
  assistantName: string;
  systemPrompt: string;
  toolsMode: "inherit" | "on" | "off";
  mutationsMode: "inherit" | "on" | "off";
  monthlyRequestLimit: number | null;
  monthlyTokenLimit: number | null;
  concurrencyLimit: number | null;
  overLimitAction: AiOverLimitAction | "inherit";
};

export type MerchantAiSettings = {
  featureEnabled: boolean;
  providerReady: boolean;
  tenantName: string;
  tenantPolicy: AiPolicyEditorValue;
  sitePolicies: AiPolicyEditorValue[];
  sites: Array<{ id: string; name: string }>;
  usage: AiUsageSummary;
};

export type AiPolicySaveInput = {
  scope: "tenant" | "site";
  siteId?: string | null;
  version: number;
  enabledMode: "inherit" | "on" | "off";
  autoReply: AiPolicyAutoReply;
  assistantName: string;
  systemPrompt: string;
  toolsMode: "inherit" | "on" | "off";
  mutationsMode: "inherit" | "on" | "off";
  monthlyRequestLimit: number | null;
  monthlyTokenLimit: number | null;
  concurrencyLimit: number | null;
  overLimitAction: AiOverLimitAction | "inherit";
};

export async function resolveAiPolicyForSite(
  siteId: string,
  configOverride?: AiConfig,
): Promise<{ tenantId: string; siteName: string; policy: EffectiveAiPolicy } | null> {
  const [config, site] = await Promise.all([
    configOverride ? Promise.resolve(configOverride) : getAiConfig(),
    prisma.site.findUnique({
      where: { id: siteId },
      select: {
        name: true,
        tenantId: true,
        aiPolicy: true,
        tenant: {
          select: {
            features: true,
            aiPolicy: true,
          },
        },
      },
    }),
  ]);
  if (!site) return null;
  const policy = resolveEffectiveAiPolicy(config, {
    featuresAi: readFeatures(site.tenant.features).ai,
    tenant: tenantPolicyFields(site.tenant.aiPolicy),
    site: sitePolicyFields(site.aiPolicy),
  });
  return { tenantId: site.tenantId, siteName: site.name, policy };
}

export async function getMerchantAiSettings(user: SessionUser): Promise<MerchantAiSettings> {
  if (user.role !== "MERCHANT_ADMIN")
    throw new HttpError(403, "仅商家管理员可管理 AI 策略");
  const [tenant, usage, config] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id: user.tenantId },
      select: {
        name: true,
        features: true,
        aiPolicy: true,
        sites: {
          select: { id: true, name: true, aiPolicy: true },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    getAiUsageSummary(user.tenantId),
    getAiConfig(),
  ]);
  const tenantPolicy = toEditorValue(
    "tenant",
    null,
    tenant.name,
    tenant.aiPolicy,
  );
  const sitePolicies = tenant.sites.map((site) =>
    toEditorValue("site", site.id, site.name, site.aiPolicy),
  );
  return {
    featureEnabled: readFeatures(tenant.features).ai,
    providerReady: Boolean(config.enabled && config.baseUrl && config.apiKey && config.model),
    tenantName: tenant.name,
    tenantPolicy,
    sitePolicies,
    sites: tenant.sites.map(({ id, name }) => ({ id, name })),
    usage,
  };
}

export async function saveMerchantAiPolicy(
  user: SessionUser,
  input: AiPolicySaveInput,
): Promise<{ version: number }> {
  if (user.role !== "MERCHANT_ADMIN")
    throw new HttpError(403, "仅商家管理员可管理 AI 策略");
  const values = normalizeSaveInput(input);
  let site: { id: string; name: string } | null = null;
  if (values.scope === "site") {
    if (!values.siteId) throw new HttpError(400, "请选择站点");
    site = await prisma.site.findFirst({
      where: { id: values.siteId, tenantId: user.tenantId },
      select: { id: true, name: true },
    });
    if (!site) throw new HttpError(403, "无权访问该站点");
  }

  const version = await prisma.$transaction(async (tx) => {
    if (values.scope === "tenant") {
      const existing = await tx.aiPolicy.findUnique({
        where: { tenantId: user.tenantId },
        select: { version: true },
      });
      await assertPolicyVersion(existing?.version, values.version, "商家 AI 策略");
      if (!existing) {
        const created = await tx.aiPolicy.create({
          data: {
            tenantId: user.tenantId,
            ...values.tenant,
            updatedById: user.id,
            updatedByName: user.name,
          },
          select: { version: true },
        });
        return created.version;
      }
      const updated = await tx.aiPolicy.updateMany({
        where: { tenantId: user.tenantId, version: values.version },
        data: {
          ...values.tenant,
          version: { increment: 1 },
          updatedById: user.id,
          updatedByName: user.name,
        },
      });
      if (!updated.count)
        throw new HttpError(409, "AI 策略已被其他页面更新，请刷新后重试");
      return values.version + 1;
    }

    const existing = await tx.aiSitePolicy.findUnique({
      where: { siteId: site!.id },
      select: { version: true },
    });
    await assertPolicyVersion(existing?.version, values.version, "站点 AI 策略");
    if (!existing) {
      const created = await tx.aiSitePolicy.create({
        data: {
          siteId: site!.id,
          tenantId: user.tenantId,
          ...values.site,
          updatedById: user.id,
          updatedByName: user.name,
        },
        select: { version: true },
      });
      return created.version;
    }
    const updated = await tx.aiSitePolicy.updateMany({
      where: { siteId: site!.id, tenantId: user.tenantId, version: values.version },
      data: {
        ...values.site,
        version: { increment: 1 },
        updatedById: user.id,
        updatedByName: user.name,
      },
    });
    if (!updated.count)
      throw new HttpError(409, "AI 策略已被其他页面更新，请刷新后重试");
    return values.version + 1;
  });

  await recordAudit({
    actorId: user.id,
    actorName: user.name,
    action: values.scope === "tenant" ? "ai.policy.tenant.update" : "ai.policy.site.update",
    targetType: values.scope === "tenant" ? "AiPolicy" : "AiSitePolicy",
    targetId: values.scope === "tenant" ? user.tenantId : site!.id,
    meta: {
      autoReply: values.autoReplyLabel,
      enabledMode: values.enabledMode,
      allowTools: values.toolsMode,
      monthlyRequestLimit: values.tenant.monthlyRequestLimit ?? values.site.monthlyRequestLimit,
      monthlyTokenLimit: values.tenant.monthlyTokenLimit ?? values.site.monthlyTokenLimit,
      concurrencyLimit: values.tenant.concurrencyLimit ?? values.site.concurrencyLimit,
    },
  });
  return { version };
}

function normalizeSaveInput(input: AiPolicySaveInput) {
  const scope = input.scope;
  const enabled = input.enabledMode === "inherit" ? null : input.enabledMode === "on";
  if (scope === "tenant" && input.enabledMode === "inherit")
    throw new HttpError(400, "商家策略必须明确启用或关闭");
  const common = {
    autoReply: input.autoReply,
    assistantName: emptyToNull(input.assistantName),
    systemPrompt: emptyToNull(input.systemPrompt),
    allowTools: modeToBoolean(input.toolsMode),
    allowMutations: modeToBoolean(input.mutationsMode),
    monthlyRequestLimit: input.monthlyRequestLimit,
    monthlyTokenLimit: input.monthlyTokenLimit,
    concurrencyLimit: input.concurrencyLimit,
    overLimitAction: input.overLimitAction === "inherit" ? null : input.overLimitAction,
  };
  const tenant = {
    enabled: enabled ?? true,
    autoReply: input.autoReply,
    assistantName: common.assistantName,
    systemPrompt: common.systemPrompt,
    allowTools: common.allowTools,
    allowMutations: common.allowMutations ?? true,
    monthlyRequestLimit: common.monthlyRequestLimit,
    monthlyTokenLimit: common.monthlyTokenLimit,
    concurrencyLimit: common.concurrencyLimit ?? 2,
    overLimitAction: common.overLimitAction ?? "skip",
  };
  const site = {
    enabled,
    autoReply: input.autoReply === "inherit" ? null : input.autoReply,
    assistantName: common.assistantName,
    systemPrompt: common.systemPrompt,
    allowTools: common.allowTools,
    allowMutations: common.allowMutations,
    monthlyRequestLimit: common.monthlyRequestLimit,
    monthlyTokenLimit: common.monthlyTokenLimit,
    concurrencyLimit: common.concurrencyLimit,
    overLimitAction: common.overLimitAction,
  };
  return {
    scope,
    siteId: input.siteId ?? null,
    version: input.version,
    enabledMode: input.enabledMode,
    autoReplyLabel: input.autoReply,
    toolsMode: input.toolsMode,
    tenant,
    site,
  };
}

function assertPolicyVersion(existing: number | undefined, expected: number, label: string) {
  if ((existing ?? 0) !== expected)
    throw new HttpError(409, `${label}已被其他页面更新，请刷新后重试`);
}

function toEditorValue(
  scope: "tenant" | "site",
  siteId: string | null,
  siteName: string,
  value: AiPolicy | AiSitePolicy | null,
): AiPolicyEditorValue {
  if (scope === "tenant") {
    const policy = tenantPolicyFields(value as AiPolicy | null);
    return {
      scope,
      siteId,
      siteName,
      version: (value as AiPolicy | null)?.version ?? 0,
      enabledMode: policy.enabled ? "on" : "off",
      autoReply: policy.autoReply,
      assistantName: policy.assistantName ?? "",
      systemPrompt: policy.systemPrompt ?? "",
      toolsMode: booleanMode(policy.allowTools),
      mutationsMode: booleanMode(policy.allowMutations),
      monthlyRequestLimit: policy.monthlyRequestLimit,
      monthlyTokenLimit: policy.monthlyTokenLimit,
      concurrencyLimit: policy.concurrencyLimit,
      overLimitAction: policy.overLimitAction,
    };
  }
  const raw = value as AiSitePolicy | null;
  const policy = sitePolicyFields(raw);
  return {
    scope,
    siteId,
    siteName,
    version: raw?.version ?? 0,
    enabledMode: raw?.enabled == null ? "inherit" : raw.enabled ? "on" : "off",
    autoReply: policy.autoReply ?? "inherit",
    assistantName: policy.assistantName ?? "",
    systemPrompt: policy.systemPrompt ?? "",
    toolsMode: booleanMode(policy.allowTools),
    mutationsMode: booleanMode(policy.allowMutations),
    monthlyRequestLimit: policy.monthlyRequestLimit,
    monthlyTokenLimit: policy.monthlyTokenLimit,
    concurrencyLimit: policy.concurrencyLimit,
    overLimitAction: policy.overLimitAction ?? "inherit",
  };
}

function tenantPolicyFields(value: AiPolicy | null): AiPolicyFields {
  if (!value) return { ...DEFAULT_TENANT_AI_POLICY };
  return {
    enabled: value.enabled,
    autoReply: readAutoReply(value.autoReply) ?? "inherit",
    assistantName: value.assistantName,
    systemPrompt: value.systemPrompt,
    allowTools: value.allowTools,
    allowMutations: value.allowMutations,
    monthlyRequestLimit: value.monthlyRequestLimit,
    monthlyTokenLimit: value.monthlyTokenLimit,
    concurrencyLimit: value.concurrencyLimit,
    overLimitAction: readOverLimit(value.overLimitAction) ?? "skip",
  };
}

function sitePolicyFields(value: AiSitePolicy | null): AiSitePolicyFields {
  if (!value) {
    return {
      enabled: null,
      autoReply: null,
      assistantName: null,
      systemPrompt: null,
      allowTools: null,
      allowMutations: null,
      monthlyRequestLimit: null,
      monthlyTokenLimit: null,
      concurrencyLimit: null,
      overLimitAction: null,
    };
  }
  return {
    enabled: value.enabled,
    autoReply: readAutoReply(value.autoReply),
    assistantName: value.assistantName,
    systemPrompt: value.systemPrompt,
    allowTools: value.allowTools,
    allowMutations: value.allowMutations,
    monthlyRequestLimit: value.monthlyRequestLimit,
    monthlyTokenLimit: value.monthlyTokenLimit,
    concurrencyLimit: value.concurrencyLimit,
    overLimitAction: readOverLimit(value.overLimitAction),
  };
}

function readAutoReply(value: string | null | undefined): AiPolicyAutoReply | null {
  return AI_AUTO_REPLY_VALUES.includes(value as AiPolicyAutoReply)
    ? (value as AiPolicyAutoReply)
    : null;
}

function readOverLimit(value: string | null | undefined): AiOverLimitAction | null {
  return AI_OVER_LIMIT_ACTIONS.includes(value as AiOverLimitAction)
    ? (value as AiOverLimitAction)
    : null;
}

function booleanMode(value: boolean | null): "inherit" | "on" | "off" {
  return value == null ? "inherit" : value ? "on" : "off";
}

function modeToBoolean(value: "inherit" | "on" | "off"): boolean | null {
  return value === "inherit" ? null : value === "on";
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
