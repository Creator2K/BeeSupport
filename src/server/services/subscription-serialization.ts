import type { SubscriptionOrder } from "@prisma/client";
import {
  effectiveOrderStatus,
  type OrderView,
} from "../../lib/subscriptions";
import { readFeatures } from "../../lib/entitlements";
import { quotaFields } from "./subscription-access";

export function serializeSubscriptionOrder(
  order: SubscriptionOrder & { tenant: { name: string } },
  includePaymentReference = false,
): OrderView {
  return {
    id: order.id,
    orderNo: order.orderNo,
    tenantName: order.tenant.name,
    status: effectiveOrderStatus(order),
    planName: order.planName,
    features: readFeatures(order.features),
    priceCents: order.priceCents,
    durationDays: order.durationDays,
    ...quotaFields(order),
    merchantNote: order.merchantNote,
    reviewNote: order.reviewNote,
    requestedByName: order.requestedByName,
    reviewedByName: order.reviewedByName,
    paymentReportedAt: order.paymentReportedAt?.toISOString() ?? null,
    paymentNote: order.paymentNote,
    paymentReportVersion: order.paymentReportVersion,
    ...(includePaymentReference
      ? { paymentReference: order.paymentReference }
      : {}),
    createdAt: order.createdAt.toISOString(),
    validUntil: order.validUntil.toISOString(),
    reviewedAt: order.reviewedAt?.toISOString() ?? null,
    periodStart: order.periodStart?.toISOString() ?? null,
    periodEnd: order.periodEnd?.toISOString() ?? null,
  };
}
