"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  type OrderView,
  formatPrice,
  orderStatusLabels,
} from "@/lib/subscriptions";
import { decideOrderAction } from "@/server/actions/subscriptions";
import { callClientAction } from "@/lib/client-action";
import { PaymentReport } from "./payment-report";
import { copyText } from "@/lib/clipboard";
import { FeatureSummary } from "./feature-summary";

const date = (value: string) =>
  new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
export function SubscriptionOrders({
  orders,
  platform = false,
}: {
  orders: OrderView[];
  platform?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<OrderView | null>(null);
  const [decision, setDecision] = useState<
    "CONFIRMED" | "REJECTED" | "CANCELLED"
  >("CONFIRMED");
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [ack, setAck] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  function open(order: OrderView, next: typeof decision) {
    setSelected(order);
    setDecision(next);
    setNote("");
    setReference("");
    setAck(false);
    setError("");
  }
  return (
    <div className="space-y-4">
      {!orders.length && (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          暂无订单记录
        </p>
      )}
      {orders.map((order) => (
        <article
          key={order.id}
          className="min-w-0 space-y-3 rounded-xl border p-4"
          data-order-id={order.id}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-medium">
                {order.planName} · {formatPrice(order.priceCents)} /{" "}
                {order.durationDays} 天
              </h3>
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                {order.orderNo}
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 h-7 px-2 text-xs"
                onClick={async () => {
                  if (await copyText(order.orderNo))
                    toast.success("订单号已复制");
                  else toast.error("复制失败，请手动复制订单号");
                }}
              >
                复制订单号
              </Button>
              {platform && (
                <p className="mt-1 text-sm">
                  {order.tenantName} · {order.requestedByName}
                </p>
              )}
            </div>
            <span className="rounded-full bg-muted px-2 py-1 text-xs">
              {orderStatusLabels[order.status] ?? order.status}
            </span>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {order.maxAgents} 个启用账号 · {order.maxSites} 个站点 · 每月{" "}
            {order.monthlyConversations} 个新会话 · {order.storageMB} MB 存储
          </p>
          <div className="space-y-1 text-xs text-muted-foreground">
            <FeatureSummary features={order.features} />
            <p>提交：{date(order.createdAt)}（北京时间）</p>
            {order.status === "PENDING" && (
              <p>报价有效至：{date(order.validUntil)}</p>
            )}
            {order.periodEnd && (
              <p>
                本次续期：{date(order.periodStart!)} → {date(order.periodEnd)}
              </p>
            )}
            {order.reviewedAt && (
              <p>
                处理：{date(order.reviewedAt)} · {order.reviewedByName}
              </p>
            )}
          </div>
          {order.merchantNote && (
            <p className="break-words text-sm">
              商家备注：{order.merchantNote}
            </p>
          )}
          {order.reviewNote && (
            <p className="break-words text-sm">处理说明：{order.reviewNote}</p>
          )}
          {order.paymentReportedAt && (
            <div className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
              <p className="font-medium">商家付款反馈（以平台实际到账为准）</p>
              <p className="whitespace-pre-wrap break-words">
                付款信息：{order.paymentNote}
              </p>
              <p className="text-xs text-muted-foreground">
                反馈时间：{date(order.paymentReportedAt)}（北京时间）
              </p>
            </div>
          )}
          {platform && order.paymentReference && (
            <p className="break-all text-sm">
              收款凭据：{order.paymentReference}
            </p>
          )}
          {order.status === "PENDING" && (
            <div className="flex flex-wrap gap-2 border-t pt-3">
              {!platform && order.priceCents > 0 && (
                <PaymentReport
                  key={`${order.id}:${order.paymentReportVersion}`}
                  order={order}
                />
              )}
              {platform && (
                <>
                  <Button size="sm" onClick={() => open(order, "CONFIRMED")}>
                    确认开通
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => open(order, "REJECTED")}
                  >
                    拒绝订单
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => open(order, "CANCELLED")}
              >
                取消订单
              </Button>
            </div>
          )}
        </article>
      ))}
      <Dialog
        open={!!selected}
        onOpenChange={(value) => !pending && !value && setSelected(null)}
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
            onSubmit={async (e) => {
              e.preventDefault();
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
            }}
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
                    onChange={(e) => setReference(e.target.value)}
                  />
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    required
                    checked={ack}
                    onChange={(e) => setAck(e.target.checked)}
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
                onChange={(e) => setNote(e.target.value)}
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
    </div>
  );
}
