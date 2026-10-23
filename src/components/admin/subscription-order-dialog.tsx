"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { callClientAction } from "@/lib/client-action";
import { formatPrice, type PlanView } from "@/lib/subscriptions";
import { submitOrderAction } from "@/server/actions/subscriptions";
import { toast } from "sonner";

import { FeatureSummary } from "./feature-summary";

function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function SubscriptionOrderDialog({
  plan,
  longTerm,
  onClose,
  onSubmitted,
}: {
  plan: PlanView;
  longTerm: boolean;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [note, setNote] = useState("");
  const [ack, setAck] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const attempts = useRef(new Map<string, string>());

  return (
    <Dialog
      open
      onOpenChange={(value) => !pending && !value && onClose()}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>确认套餐订单</DialogTitle>
          <DialogDescription>
            {plan.name} · {formatPrice(plan.priceCents)} / {plan.durationDays} 天
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError("");
            const key = `${plan.id}:${plan.updatedAt}`;
            if (!attempts.current.has(key))
              attempts.current.set(key, requestId());
            const result = await callClientAction(
              () =>
                submitOrderAction({
                  planId: plan.id,
                  expectedVersion: plan.updatedAt,
                  clientRequestId: attempts.current.get(key)!,
                  note,
                }),
              "提交失败，可重试；已成功提交的订单不会重复创建",
            );
            setPending(false);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            attempts.current.delete(key);
            toast.success(result.message);
            onSubmitted();
          }}
        >
          <p className="rounded-lg bg-muted p-3 text-sm leading-6">
            订单报价有效期为 7
            天。提交后请联系平台完成付款及开通确认，确认开通时立即使用新额度。尚未到期的有效期顺延，已到期的从确认当天开始计算。新套餐不会重置本月已使用的会话数。
          </p>
          <FeatureSummary features={plan.features} />
          {longTerm && (
            <p className="rounded-lg border border-amber-400 p-3 text-sm leading-6">
              当前商家长期有效。此订单开通后，会改为从确认当天起{" "}
              {plan.durationDays} 天的有限有效期。
            </p>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={ack}
              required
              onChange={(event) => setAck(event.target.checked)}
              className="mt-1"
            />
            我已确认本次价格、额度及有效期规则
          </label>
          <div className="space-y-2">
            <Label htmlFor="merchant-order-note">订单备注（选填）</Label>
            <Textarea
              id="merchant-order-note"
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={pending || !ack}>
            {pending ? "提交中…" : "提交订单，等待平台确认"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
