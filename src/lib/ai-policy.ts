import type { AiAutoReply, AiConfig } from "./ai-config";

export const AI_AUTO_REPLY_VALUES = ["inherit", "off", "no_agent", "always"] as const;
export type AiPolicyAutoReply = (typeof AI_AUTO_REPLY_VALUES)[number];
export const AI_OVER_LIMIT_ACTIONS = ["skip", "handoff"] as const;
export type AiOverLimitAction = (typeof AI_OVER_LIMIT_ACTIONS)[number];

export type AiPolicyFields = {
  enabled: boolean;
  autoReply: AiPolicyAutoReply;
  assistantName: string | null;
  systemPrompt: string | null;
  allowTools: boolean | null;
  allowMutations: boolean;
  monthlyRequestLimit: number | null;
  monthlyTokenLimit: number | null;
  concurrencyLimit: number;
  overLimitAction: AiOverLimitAction;
};

export type AiSitePolicyFields = {
  enabled: boolean | null;
  autoReply: AiPolicyAutoReply | null;
  assistantName: string | null;
  systemPrompt: string | null;
  allowTools: boolean | null;
  allowMutations: boolean | null;
  monthlyRequestLimit: number | null;
  monthlyTokenLimit: number | null;
  concurrencyLimit: number | null;
  overLimitAction: AiOverLimitAction | null;
};

export type AiPolicySource = {
  featuresAi: boolean;
  tenant: AiPolicyFields | null;
  site: AiSitePolicyFields | null;
};

export type EffectiveAiPolicy = {
  enabled: boolean;
  config: AiConfig;
  autoReply: AiAutoReply;
  allowMutations: boolean;
  monthlyRequestLimit: number | null;
  monthlyTokenLimit: number | null;
  requestLimitScope: "tenant" | "site";
  tokenLimitScope: "tenant" | "site";
  concurrencyLimit: number;
  overLimitAction: AiOverLimitAction;
};

export const DEFAULT_TENANT_AI_POLICY: AiPolicyFields = {
  enabled: true,
  autoReply: "inherit",
  assistantName: null,
  systemPrompt: null,
  allowTools: null,
  allowMutations: true,
  monthlyRequestLimit: null,
  monthlyTokenLimit: null,
  concurrencyLimit: 2,
  overLimitAction: "skip",
};

export function normalizePositiveLimit(value: number | null | undefined): number | null {
  if (value == null || value === 0) return null;
  return Math.min(100_000_000, Math.max(1, Math.trunc(value)));
}

export function normalizeConcurrency(value: number | null | undefined): number {
  return Math.min(8, Math.max(1, Math.trunc(value ?? 2)));
}

export function resolveEffectiveAiPolicy(
  config: AiConfig,
  source: AiPolicySource,
): EffectiveAiPolicy {
  const tenant = source.tenant ?? DEFAULT_TENANT_AI_POLICY;
  const site = source.site;
  const tenantEnabled = source.featuresAi && config.enabled && tenant.enabled;
  const enabled = tenantEnabled && site?.enabled !== false;
  const autoReply =
    (site?.autoReply && site.autoReply !== "inherit" ? site.autoReply : null) ??
    (tenant.autoReply !== "inherit" ? tenant.autoReply : null) ??
    config.autoReply;
  const siteRequestLimit =
    site?.monthlyRequestLimit !== null && site?.monthlyRequestLimit !== undefined
      ? site.monthlyRequestLimit
      : null;
  const siteTokenLimit =
    site?.monthlyTokenLimit !== null && site?.monthlyTokenLimit !== undefined
      ? site.monthlyTokenLimit
      : null;
  const requestLimit = siteRequestLimit ?? tenant.monthlyRequestLimit;
  const tokenLimit = siteTokenLimit ?? tenant.monthlyTokenLimit;

  return {
    enabled,
    autoReply,
    allowMutations: site?.allowMutations ?? tenant.allowMutations,
    monthlyRequestLimit: normalizePositiveLimit(requestLimit),
    monthlyTokenLimit: normalizePositiveLimit(tokenLimit),
    requestLimitScope: siteRequestLimit != null ? "site" : "tenant",
    tokenLimitScope: siteTokenLimit != null ? "site" : "tenant",
    concurrencyLimit: normalizeConcurrency(site?.concurrencyLimit ?? tenant.concurrencyLimit),
    overLimitAction:
      site?.overLimitAction ?? tenant.overLimitAction ?? "skip",
    config: {
      ...config,
      enabled,
      assistantName:
        nonEmpty(site?.assistantName) ??
        nonEmpty(tenant.assistantName) ??
        config.assistantName,
      systemPrompt:
        nonEmpty(site?.systemPrompt) ??
        nonEmpty(tenant.systemPrompt) ??
        config.systemPrompt,
      enableTools: site?.allowTools ?? tenant.allowTools ?? config.enableTools,
      autoReply,
    },
  };
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function effectiveAutoReply(
  policy: EffectiveAiPolicy,
): AiAutoReply {
  return policy.enabled ? policy.autoReply : "off";
}
