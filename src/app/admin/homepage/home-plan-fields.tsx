"use client";

import { Button } from "@/components/ui/button";
import type { HomeContent } from "@/lib/homepage-content";

import type {
  HomePlanOption,
  UpdateHomeContent,
} from "./home-editor-types";

export function HomePlanFields({
  content,
  plans,
  update,
  disabled,
}: {
  content: HomeContent;
  plans: HomePlanOption[];
  update: UpdateHomeContent;
  disabled: boolean;
}) {
  return (
    <fieldset
      disabled={disabled}
      className="min-w-0 space-y-3 rounded-xl border p-4 sm:p-6"
    >
      <legend className="px-1 font-medium">公开展示套餐（最多 6 个）</legend>
      <p className="text-xs text-muted-foreground">
        只展示勾选且仍上架的套餐，按勾选先后排序；名称、价格和额度跟随套餐管理同步。不勾选时不展示套餐区块。
      </p>
      {plans.map((plan) => (
        <label
          key={plan.id}
          className="flex items-start gap-2 rounded-lg border p-3 text-sm"
        >
          <input
            type="checkbox"
            className="mt-1"
            checked={content.planIds.includes(plan.id)}
            disabled={
              !content.planIds.includes(plan.id) && content.planIds.length >= 6
            }
            onChange={(event) =>
              update(
                "planIds",
                event.target.checked
                  ? [...content.planIds, plan.id]
                  : content.planIds.filter((id) => id !== plan.id),
              )
            }
          />
          <span className="min-w-0 break-words">
            {plan.name} · ¥{(plan.priceCents / 100).toFixed(2)} /{" "}
            {plan.durationDays} 天
          </span>
        </label>
      ))}
      {!plans.length && (
        <p className="text-sm text-muted-foreground">
          请先在套餐管理中创建并上架套餐。
        </p>
      )}
      {content.planIds
        .filter((planId) => !plans.some((plan) => plan.id === planId))
        .map((planId) => (
          <div
            key={planId}
            className="flex items-center justify-between gap-2 text-sm text-destructive"
          >
            <span>原选择的套餐已下架，请移除后发布</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                update(
                  "planIds",
                  content.planIds.filter((id) => id !== planId),
                )
              }
            >
              移除失效套餐
            </Button>
          </div>
        ))}
    </fieldset>
  );
}
