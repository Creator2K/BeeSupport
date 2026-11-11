"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { saveMerchantAiPolicy } from "@/server/services/ai-policy";
import { toActionResult, type ActionResult } from "./result";
import { aiPolicySaveSchema, type AiPolicySavePayload } from "./ai-policy-schemas";

export async function saveMerchantAiPolicyAction(
  input: AiPolicySavePayload,
): Promise<ActionResult & { version?: number }> {
  try {
    const user = await requireAdmin();
    const data = aiPolicySaveSchema.parse(input);
    const result = await saveMerchantAiPolicy(user, data);
    revalidatePath("/admin", "layout");
    return { ok: true, message: "AI 策略已保存", version: result.version };
  } catch (error) {
    return toActionResult(error);
  }
}
