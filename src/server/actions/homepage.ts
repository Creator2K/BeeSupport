"use server";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth";
import { saveHomeDraft, publishHome } from "@/server/services/homepage";
import { toActionResult } from "./result";
export async function saveHomeDraftAction(input: unknown, revision: string) {
  try {
    const next = await saveHomeDraft(
      await requirePlatformAdmin(),
      input,
      revision,
    );
    return {
      ok: true as const,
      message: "草稿已保存，公开首页未改变",
      revision: next,
    };
  } catch (error) {
    return toActionResult(error);
  }
}
export async function publishHomeAction(
  revision: string,
  publishedRevision: string,
) {
  try {
    const next = await publishHome(
      await requirePlatformAdmin(),
      revision,
      publishedRevision,
    );
    revalidatePath("/");
    return { ok: true as const, message: "首页已发布", revision: next };
  } catch (error) {
    return toActionResult(error);
  }
}
