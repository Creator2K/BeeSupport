"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin, requirePlatformAdmin } from "@/lib/auth";
import { ADMIN_PATH } from "@/lib/app-paths";
import { planInputSchema, type PlanInput } from "@/lib/subscriptions";
import {
  saveSubscriptionPlan,
  submitSubscriptionOrder,
  decideSubscriptionOrder,
  reportSubscriptionPayment,
} from "@/server/services/subscriptions";
import { toActionResult } from "./result";

function refresh() {
  revalidatePath("/admin", "layout");
  if (ADMIN_PATH !== "/admin") revalidatePath(ADMIN_PATH, "layout");
}
export async function reportPaymentAction(id: string, input: unknown) {
  try {
    const user = await requireAdmin();
    const result = await reportSubscriptionPayment(
      user,
      z.string().min(1).max(128).parse(id),
      input,
    );
    refresh();
    return {
      ok: true as const,
      message: result.changed
        ? "付款信息已提交，等待平台核对后开通"
        : "付款信息已收到，无需重复提交",
    };
  } catch (error) {
    return toActionResult(error);
  }
}
export async function savePlanAction(
  input: PlanInput,
  id?: string,
  expectedVersion?: string,
) {
  try {
    const admin = await requirePlatformAdmin();
    const plan = await saveSubscriptionPlan(
      admin,
      planInputSchema.parse(input),
      id,
      expectedVersion,
    );
    refresh();
    return {
      ok: true as const,
      message: plan.active ? "套餐已保存并上架" : "套餐已保存为下架状态",
      id: plan.id,
    };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function submitOrderAction(input: {
  planId: string;
  expectedVersion: string;
  clientRequestId: string;
  note: string;
}) {
  try {
    const admin = await requireAdmin();
    const parsed = z
      .object({
        planId: z.string().min(1).max(128),
        expectedVersion: z.string().datetime(),
        clientRequestId: z.string().uuid(),
        note: z.string().trim().max(500),
      })
      .parse(input);
    const order = await submitSubscriptionOrder(admin, parsed);
    refresh();
    return {
      ok: true as const,
      message: "订单已提交，请联系平台完成付款及开通确认",
      id: order.id,
    };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function decideOrderAction(
  id: string,
  input: {
    decision: "CONFIRMED" | "REJECTED" | "CANCELLED";
    note: string;
    paymentReference: string;
    acknowledged: boolean;
  },
) {
  try {
    const parsed = z
      .object({
        decision: z.enum(["CONFIRMED", "REJECTED", "CANCELLED"]),
        note: z.string().trim().max(500),
        paymentReference: z.string().trim().max(200),
        acknowledged: z.boolean(),
      })
      .parse(input);
    const admin =
      parsed.decision === "CANCELLED"
        ? await requireAdmin()
        : await requirePlatformAdmin();
    const result = await decideSubscriptionOrder(
      admin,
      z.string().min(1).max(128).parse(id),
      parsed,
    );
    refresh();
    return {
      ok: true as const,
      message: !result.changed
        ? "该订单已处理，无需重复操作"
        : parsed.decision === "CONFIRMED"
          ? "已确认开通，有效期和额度已更新"
          : parsed.decision === "REJECTED"
            ? "订单已拒绝"
            : "订单已取消",
    };
  } catch (error) {
    return toActionResult(error);
  }
}
