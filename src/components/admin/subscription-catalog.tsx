"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { type PlanView, formatPrice, quotaConflict } from "@/lib/subscriptions";
import { submitOrderAction } from "@/server/actions/subscriptions";
import { callClientAction } from "@/lib/client-action";
import { FeatureSummary } from "./feature-summary";

function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function SubscriptionCatalog({
  plans,
  usage,
  pendingOrder,
  longTerm,
}: {
  plans: PlanView[];
  usage: {
    agents: number;
    sites: number;
    conversations: number;
    storageBytes: number;
  };
  pendingOrder: boolean;
  longTerm: boolean;
}) {
  const [selected, setSelected] = useState<PlanView | null>(null);
  const [note, setNote] = useState("");
  const [ack, setAck] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const attempts = useRef(new Map<string, string>());
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
        {plans.map((plan) => {
          const conflict = quotaConflict(plan, usage);
          return (
            <article
              key={plan.id}
              className="min-w-0 space-y-3 rounded-xl border p-4"
            >
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
                onClick={() => {
                  setSelected(plan);
                  setAck(false);
                  setNote("");
                  setError("");
                }}
              >
                选择套餐
              </Button>
            </article>
          );
        })}
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(value) => !pending && !value && setSelected(null)}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>确认套餐订单</DialogTitle>
            <DialogDescription>
              {selected?.name} · {formatPrice(selected?.priceCents ?? 0)} /{" "}
              {selected?.durationDays} 天
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!selected) return;
              setPending(true);
              setError("");
              const key = `${selected.id}:${selected.updatedAt}`;
              if (!attempts.current.has(key))
                attempts.current.set(key, requestId());
              const result = await callClientAction(
                () =>
                  submitOrderAction({
                    planId: selected.id,
                    expectedVersion: selected.updatedAt,
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
              setSelected(null);
              router.refresh();
            }}
          >
            <p className="rounded-lg bg-muted p-3 text-sm leading-6">
              订单报价有效期为 7
              天。提交后请联系平台完成付款及开通确认，确认开通时立即使用新额度。尚未到期的有效期顺延，已到期的从确认当天开始计算。新套餐不会重置本月已使用的会话数。
            </p>
            <FeatureSummary features={selected?.features} />
            {longTerm && (
              <p className="rounded-lg border border-amber-400 p-3 text-sm leading-6">
                当前商家长期有效。此订单开通后，会改为从确认当天起{" "}
                {selected?.durationDays} 天的有限有效期。
              </p>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={ack}
                required
                onChange={(e) => setAck(e.target.checked)}
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
                onChange={(e) => setNote(e.target.value)}
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
    </div>
  );
}
