"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ADMIN_PATH } from "@/lib/app-paths";
import { visibleNoticeWhere } from "@/server/services/account-notices";
import { toActionResult } from "./result";
export async function markNoticesReadAction(id?: string) {
  try {
    const noticeId = z.string().min(1).max(128).optional().parse(id);
    const user = await requireAdmin();
    await prisma.accountNotice.updateMany({
      where: {
        ...(await visibleNoticeWhere(user)),
        readAt: null,
        ...(noticeId ? { id: noticeId } : {}),
      },
      data: { readAt: new Date() },
    });
    // The custom server renders the public admin entry through /admin.
    revalidatePath("/admin", "layout");
    if (ADMIN_PATH !== "/admin") revalidatePath(ADMIN_PATH, "layout");
    return { ok: true as const, message: "通知已标记为已读" };
  } catch (error) {
    return toActionResult(error);
  }
}
