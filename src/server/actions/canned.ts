"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import type { CannedInput } from "@/lib/canned";
import { saveCannedReply, deleteCannedReply } from "@/server/services/canned";
import { toActionResult, type ActionResult } from "./result";
export type { CannedInput } from "@/lib/canned";

export async function createCannedAction(
  input: CannedInput,
): Promise<ActionResult & { id?: string }> {
  try {
    const item = await saveCannedReply(await requireAdmin(), input);
    revalidatePath("/admin/canned");
    return { ok: true, message: "话术已创建", id: item.id };
  } catch (error) {
    return toActionResult(error);
  }
}
export async function updateCannedAction(
  id: string,
  input: CannedInput,
): Promise<ActionResult> {
  try {
    await saveCannedReply(await requireAdmin(), input, id);
    revalidatePath("/admin/canned");
    return { ok: true, message: "话术已更新" };
  } catch (error) {
    return toActionResult(error);
  }
}
export async function deleteCannedAction(id: string): Promise<ActionResult> {
  try {
    await deleteCannedReply(await requireAdmin(), id);
    revalidatePath("/admin/canned");
    return { ok: true, message: "话术已删除" };
  } catch (error) {
    return toActionResult(error);
  }
}
