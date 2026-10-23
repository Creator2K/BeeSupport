"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { PlanView } from "@/lib/subscriptions";

import { SubscriptionOrderDialog } from "./subscription-order-dialog";
import { SubscriptionPlanCard } from "./subscription-plan-card";
import type { SubscriptionUsage } from "./subscription-catalog-types";

export function SubscriptionCatalog({
  plans,
  usage,
  pendingOrder,
  longTerm,
}: {
  plans: PlanView[];
  usage: SubscriptionUsage;
  pendingOrder: boolean;
  longTerm: boolean;
}) {
  const [selected, setSelected] = useState<PlanView | null>(null);
  const router = useRouter();

  return (
    <div className="space-y-4">
      {pendingOrder && (
        <p role="status" className="rounded-lg border bg-muted p-3 text-sm">
          你有一笔待平台确认的订单，请在下方订单记录中查看或取消。
        </p>
      )}
      {!plans.length && (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          平台尚未上架套餐，续期或调整额度请联系平台管理员。
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan) => (
          <SubscriptionPlanCard
            key={plan.id}
            plan={plan}
            usage={usage}
            pendingOrder={pendingOrder}
            onSelect={() => setSelected(plan)}
          />
        ))}
      </div>
      {selected && (
        <SubscriptionOrderDialog
          key={`${selected.id}:${selected.updatedAt}`}
          plan={selected}
          longTerm={longTerm}
          onClose={() => setSelected(null)}
          onSubmitted={() => {
            setSelected(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
