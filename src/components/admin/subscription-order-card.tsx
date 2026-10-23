"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import {
  formatPrice,
  orderStatusLabels,
  type OrderView,
} from "@/lib/subscriptions";

import { FeatureSummary } from "./feature-summary";
import { PaymentReport } from "./payment-report";
import type { OrderDecision } from "./subscription-order-types";

const date = (value: string) =>
  new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

export function SubscriptionOrderCard({
  order,
  platform,
  onDecision,
}: {
  order: OrderView;
  platform: boolean;
  onDecision: (order: OrderView, decision: OrderDecision) => void;
}) {
  return (
    <article
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
              <Button size="sm" onClick={() => onDecision(order, "CONFIRMED")}>
                确认开通
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onDecision(order, "REJECTED")}
              >
                拒绝订单
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDecision(order, "CANCELLED")}
          >
            取消订单
          </Button>
        </div>
      )}
    </article>
  );
}
