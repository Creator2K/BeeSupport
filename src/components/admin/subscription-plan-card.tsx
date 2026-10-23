"use client";

import { Button } from "@/components/ui/button";
import {
  formatPrice,
  quotaConflict,
  type PlanView,
} from "@/lib/subscriptions";

import { FeatureSummary } from "./feature-summary";
import type { SubscriptionUsage } from "./subscription-catalog-types";

export function SubscriptionPlanCard({
  plan,
  usage,
  pendingOrder,
  onSelect,
}: {
  plan: PlanView;
  usage: SubscriptionUsage;
  pendingOrder: boolean;
  onSelect: () => void;
}) {
  const conflict = quotaConflict(plan, usage);

  return (
    <article className="min-w-0 space-y-3 rounded-xl border p-4">
      <h3 className="font-medium">{plan.name}</h3>
      <p className="text-2xl font-semibold">
        {formatPrice(plan.priceCents)}
        <span className="ml-1 text-xs font-normal text-muted-foreground">
          / {plan.durationDays} 天
        </span>
      </p>
      <p className="break-words text-sm text-muted-foreground">
        {plan.description}
      </p>
      <p className="text-sm leading-6">
        {plan.maxAgents} 个启用账号 · {plan.maxSites} 个站点
        <br />
        每月 {plan.monthlyConversations} 个新会话
        <br />
        {plan.storageMB} MB 存储
      </p>
      {conflict && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {conflict}
        </p>
      )}
      <FeatureSummary features={plan.features} />
      <Button
        className="w-full"
        disabled={pendingOrder || !!conflict}
        onClick={onSelect}
      >
        选择套餐
      </Button>
    </article>
  );
}
