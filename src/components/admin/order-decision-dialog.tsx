"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatPrice, type OrderView } from "@/lib/subscriptions";

import type { OrderDecision } from "./subscription-order-types";

type OrderDecisionDialogProps = {
  selected: OrderView | null;
  decision: OrderDecision;
  note: string;
  reference: string;
  ack: boolean;
  pending: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onNoteChange: (value: string) => void;
  onReferenceChange: (value: string) => void;
  onAckChange: (value: boolean) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
};

export function OrderDecisionDialog({
  selected,
  decision,
  note,
  reference,
  ack,
  pending,
  error,
  onOpenChange,
  onNoteChange,
  onReferenceChange,
  onAckChange,
  onSubmit,
}: OrderDecisionDialogProps) {
  return (
    <Dialog
      open={Boolean(selected)}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {decision === "CONFIRMED"
              ? "确认订单并开通"
              : decision === "REJECTED"
                ? "拒绝订单"
                : "取消订单"}
          </DialogTitle>
          <DialogDescription>
            {selected?.orderNo} · {selected?.planName} ·{" "}
            {formatPrice(selected?.priceCents ?? 0)}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={onSubmit}
        >
          {decision === "CANCELLED" && selected?.paymentReportedAt && (
            <p className="rounded-lg bg-muted p-3 text-sm leading-6">
              此订单已反馈付款。取消订单不会自动退款，请先联系平台核对到账及退款安排。
            </p>
          )}
          {decision === "CONFIRMED" && (
            <>
              <p className="rounded-lg bg-muted p-3 text-sm leading-6">
                使用下单时的套餐快照立即更新额度；有效期从尚未到期的服务截止日顺延，已到期或长期有效的从现在开始计算{" "}
                {selected?.durationDays} 天。开通后订单无法再次处理。
              </p>
              {selected?.paymentReportedAt && (
                <p className="whitespace-pre-wrap break-words text-sm">
                  商家付款信息（待核实）：{selected.paymentNote}
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="payment-reference">
                  收款凭据 / 交易流水号
                  {selected?.priceCents
                    ? "（必填，仅平台可见）"
                    : "（仅平台可见）"}
                </Label>
                <Input
                  id="payment-reference"
                  maxLength={200}
                  required={!!selected?.priceCents}
                  value={reference}
                  onChange={(e) => onReferenceChange(e.target.value)}
                />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  required
                  checked={ack}
                  onChange={(e) => onAckChange(e.target.checked)}
                  className="mt-1"
                />
                我已核对收款，或确认本订单获准免费开通
              </label>
            </>
          )}
          <div className="space-y-2">
            <Label htmlFor="order-review-note">
              {decision === "REJECTED"
                ? "拒绝原因（商家可见，必填）"
                : "处理说明（商家可见）"}
            </Label>
            <Textarea
              id="order-review-note"
              maxLength={500}
              required={decision === "REJECTED"}
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button className="w-full" type="submit" disabled={pending}>
            {pending
              ? "处理中…"
              : decision === "CONFIRMED"
                ? "确认收款并开通"
                : decision === "REJECTED"
                  ? "提交拒绝原因"
                  : "确认取消订单"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
