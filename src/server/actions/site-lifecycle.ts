import { revalidatePath } from "next/cache";

import { HttpError, requireAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { adminDb } from "@/lib/tenant-db";
import { toActionResult, type ActionResult } from "./result";
import { generatePublicKey } from "./site-schemas";

export async function deleteSiteAction(id: string): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const prisma = await adminDb();

    const site = await prisma.site.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!site) throw new HttpError(404, "站点不存在");

    await prisma.site.delete({ where: { id } });

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "site.delete",
      targetType: "Site",
      targetId: id,
      meta: { name: site.name },
    });

    revalidatePath("/admin/sites");
    revalidatePath("/admin");
    return { ok: true, message: "站点已删除" };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function regenerateSiteKeyAction(
  id: string,
): Promise<ActionResult & { publicKey?: string }> {
  try {
    const admin = await requireAdmin();
    const prisma = await adminDb();

    const site = await prisma.site.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!site) throw new HttpError(404, "站点不存在");

    const publicKey = generatePublicKey();
    await prisma.site.update({ where: { id }, data: { publicKey } });

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "site.regenerate_key",
      targetType: "Site",
      targetId: id,
      meta: { name: site.name },
    });

    revalidatePath("/admin/sites");
    return { ok: true, message: "接入密钥已重置", publicKey };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function toggleSiteActiveAction(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const prisma = await adminDb();
    await prisma.site.update({ where: { id }, data: { active } });

    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: active ? "site.enable" : "site.disable",
      targetType: "Site",
      targetId: id,
    });

    revalidatePath("/admin/sites");
    return { ok: true };
  } catch (error) {
    return toActionResult(error);
  }
}
