import type { Prisma } from "@prisma/client";

import { prisma } from "../../lib/db";
import type { EffectiveAiPolicy } from "../../lib/ai-policy";

export type AiQuotaBlock = {
  ok: false;
  reason: "request_limit" | "token_limit";
  action: EffectiveAiPolicy["overLimitAction"];
};
export type AiQuotaDecision = { ok: true } | AiQuotaBlock;

export type AiUsageSummary = {
  month: string;
  totals: AiUsageTotals;
  sites: Array<AiUsageTotals & { siteId: string; siteName: string }>;
};

export type AiUsageTotals = {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  failures: number;
};

export function shanghaiDay(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

export function shanghaiMonth(now = new Date()): string {
  return shanghaiDay(now).slice(0, 7);
}

function monthStartDay(now = new Date()): string {
  return `${shanghaiMonth(now)}-01`;
}

function estimateRunTokens(policy: EffectiveAiPolicy): number {
  const rounds = policy.config.enableTools
    ? policy.config.maxToolRounds + 1
    : 1;
  // Prompt size and tool payloads vary; this is deliberately conservative.
  return Math.min(64_000, policy.config.maxTokens * rounds + 500);
}

async function usageWhere(
  tenantId: string,
  siteId: string,
  scope: "tenant" | "site",
  now: Date,
): Promise<Prisma.AiUsageDailyWhereInput> {
  return {
    tenantId,
    ...(scope === "site" ? { siteId } : {}),
    day: { gte: monthStartDay(now) },
  };
}

/** Monthly limits are checked before generation. Concurrent runs can exceed the remainder by at most one reserve. */
export async function checkAiQuota(
  tenantId: string,
  siteId: string,
  policy: EffectiveAiPolicy,
  now = new Date(),
): Promise<AiQuotaDecision> {
  if (!policy.enabled) return { ok: true };
  if (!policy.monthlyRequestLimit && !policy.monthlyTokenLimit) return { ok: true };

  const [requestUsage, tokenUsage] = await Promise.all([
    policy.monthlyRequestLimit
      ? prisma.aiUsageDaily.aggregate({
          where: await usageWhere(tenantId, siteId, policy.requestLimitScope, now),
          _sum: { requests: true },
        })
      : null,
    policy.monthlyTokenLimit
      ? prisma.aiUsageDaily.aggregate({
          where: await usageWhere(tenantId, siteId, policy.tokenLimitScope, now),
          _sum: { promptTokens: true, completionTokens: true },
        })
      : null,
  ]);

  if (
    policy.monthlyRequestLimit &&
    (requestUsage?._sum.requests ?? 0) >= policy.monthlyRequestLimit
  )
    return { ok: false, reason: "request_limit", action: policy.overLimitAction };

  const usedTokens =
    (tokenUsage?._sum.promptTokens ?? 0) +
    (tokenUsage?._sum.completionTokens ?? 0);
  if (
    policy.monthlyTokenLimit &&
    usedTokens + estimateRunTokens(policy) > policy.monthlyTokenLimit
  )
    return { ok: false, reason: "token_limit", action: policy.overLimitAction };

  return { ok: true };
}

export async function recordAiUsage(input: {
  tenantId: string;
  siteId: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  failed?: boolean;
  now?: Date;
}) {
  const day = shanghaiDay(input.now);
  const requests = Math.max(0, Math.trunc(input.requests));
  const promptTokens = Math.max(0, Math.trunc(input.promptTokens));
  const completionTokens = Math.max(0, Math.trunc(input.completionTokens));
  await prisma.aiUsageDaily.upsert({
    where: {
      tenantId_siteId_day: { tenantId: input.tenantId, siteId: input.siteId, day },
    },
    create: {
      tenantId: input.tenantId,
      siteId: input.siteId,
      day,
      requests,
      promptTokens,
      completionTokens,
      failures: input.failed ? 1 : 0,
    },
    update: {
      requests: { increment: requests },
      promptTokens: { increment: promptTokens },
      completionTokens: { increment: completionTokens },
      failures: input.failed ? { increment: 1 } : undefined,
    },
  });
}

export async function getAiUsageSummary(
  tenantId: string,
  now = new Date(),
): Promise<AiUsageSummary> {
  const [rows, sites] = await Promise.all([
    prisma.aiUsageDaily.groupBy({
      by: ["siteId"],
      where: { tenantId, day: { gte: monthStartDay(now) } },
      _sum: {
        requests: true,
        promptTokens: true,
        completionTokens: true,
        failures: true,
      },
    }),
    prisma.site.findMany({
      where: { tenantId },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const bySite = new Map(rows.map((row) => [row.siteId, row]));
  const siteTotals = sites.map((site) => {
    const row = bySite.get(site.id);
    const promptTokens = row?._sum.promptTokens ?? 0;
    const completionTokens = row?._sum.completionTokens ?? 0;
    return {
      siteId: site.id,
      siteName: site.name,
      requests: row?._sum.requests ?? 0,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      failures: row?._sum.failures ?? 0,
    };
  });
  const totals = siteTotals.reduce<AiUsageTotals>(
    (sum, row) => ({
      requests: sum.requests + row.requests,
      promptTokens: sum.promptTokens + row.promptTokens,
      completionTokens: sum.completionTokens + row.completionTokens,
      totalTokens: sum.totalTokens + row.totalTokens,
      failures: sum.failures + row.failures,
    }),
    { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, failures: 0 },
  );
  return { month: shanghaiMonth(now), totals, sites: siteTotals };
}
