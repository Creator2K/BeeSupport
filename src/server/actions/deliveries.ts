"use server";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth";
import { ADMIN_PATH } from "@/lib/app-paths";
import { retryDelivery } from "@/server/services/deliveries";
import type { RetryDeliveryInput } from "@/lib/deliveries";
import { toActionResult } from "./result";

export async function retryDeliveryAction(input: RetryDeliveryInput) {
  try {
    await retryDelivery(await requirePlatformAdmin(), input);
    revalidatePath("/admin/deliveries");
    revalidatePath(`${ADMIN_PATH}/deliveries`);
    return { ok: true as const, message: "任务已重新排队，后台会自动发送" };
  } catch (error) {
    return toActionResult(error);
  }
}
