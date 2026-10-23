"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { type OrderView, formatPrice } from "@/lib/subscriptions";
import { reportPaymentAction } from "@/server/actions/subscriptions";
import { callClientAction } from "@/lib/client-action";

export function PaymentReport({ order }: { order: OrderView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false),
    [note, setNote] = useState(order.paymentNote),
    [ack, setAck] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setNote(order.paymentNote);
          setAck(false);
          setError("");
          setOpen(true);
        }}
      >
        {order.paymentReportedAt ? "更新付款信息" : "我已付款，提交核对"}
      </Button>
      <Dialog open={open} onOpenChange={(value) => !pending && setOpen(value)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>反馈付款信息</DialogTitle>
            <DialogDescription className="break-all">
              {order.orderNo} · {formatPrice(order.priceCents)} ·{" "}
              {order.planName}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              setError("");
              const result = await callClientAction(
                () =>
                  reportPaymentAction(order.id, {
                    note,
                    acknowledged: ack,
                    expectedVersion: order.paymentReportVersion,
                  }),
                "提交失败，请重试",
              );
              setPending(false);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              toast.success(result.message);
              setOpen(false);
              router.refresh();
            }}
          >
            <p className="rounded-lg bg-muted p-3 text-sm leading-6">
              请核对订单金额和收款方，完成付款后填写相关信息。平台核对实际到账后才会开通套餐，请勿重复付款。
            </p>
            <div className="space-y-2">
              <Label htmlFor="payment-report-note">付款信息（平台可见）</Label>
              <Textarea
                id="payment-report-note"
                required
                maxLength={500}
                rows={4}
                placeholder="例如：付款渠道、付款人、转账时间或交易流水末尾。"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                className="mt-1"
                type="checkbox"
                required
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              我已完成本订单付款，提交的信息供平台人工核对
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button className="w-full" type="submit" disabled={pending}>
              {pending ? "提交中…" : "提交付款信息"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
