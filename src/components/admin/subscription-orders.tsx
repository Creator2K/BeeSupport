"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { callClientAction } from "@/lib/client-action";
import type { OrderView } from "@/lib/subscriptions";
import { decideOrderAction } from "@/server/actions/subscriptions";

import { OrderDecisionDialog } from "./order-decision-dialog";
import { SubscriptionOrderCard } from "./subscription-order-card";
import type { OrderDecision } from "./subscription-order-types";

export function SubscriptionOrders({
  orders,
  platform = false,
}: {
  orders: OrderView[];
  platform?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<OrderView | null>(null);
  const [decision, setDecision] = useState<OrderDecision>("CONFIRMED");
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [ack, setAck] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  function open(order: OrderView, next: OrderDecision) {
    setSelected(order);
    setDecision(next);
    setNote("");
    setReference("");
    setAck(false);
    setError("");
  }

  async function submitDecision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setPending(true);
    setError("");
    const result = await callClientAction(
      () =>
        decideOrderAction(selected.id, {
          decision,
          note,
          paymentReference: reference,
          acknowledged: ack,
        }),
      "订单处理失败，请重试",
    );
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(result.message);
    setSelected(null);
    router.refresh();
  }
  return (
    <div className="space-y-4">
      {!orders.length && (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          暂无订单记录
        </p>
      )}
      {orders.map((order) => (
        <SubscriptionOrderCard
          key={order.id}
          order={order}
          platform={platform}
          onDecision={open}
        />
      ))}
      <OrderDecisionDialog
        selected={selected}
        decision={decision}
        note={note}
        reference={reference}
        ack={ack}
        pending={pending}
        error={error}
        onOpenChange={(value) => !pending && !value && setSelected(null)}
        onNoteChange={setNote}
        onReferenceChange={setReference}
        onAckChange={setAck}
        onSubmit={(event) => void submitDecision(event)}
      />
    </div>
  );
}
