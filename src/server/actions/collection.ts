"use server";
import { requirePlatformAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { ADMIN_PATH } from "@/lib/app-paths";
import { saveCollectionSettings } from "@/server/services/collection";
import { toActionResult } from "./result";
export async function saveCollectionAction(input: unknown, revision: string) {
  try {
    const revisionNext = await saveCollectionSettings(
      await requirePlatformAdmin(),
      input,
      revision,
    );
    revalidatePath("/admin", "layout");
    if (ADMIN_PATH !== "/admin") revalidatePath(ADMIN_PATH, "layout");
    return {
      ok: true as const,
      message: "收款配置已保存",
      revision: revisionNext,
    };
  } catch (error) {
    return toActionResult(error);
  }
}
