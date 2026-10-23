"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { adminDb } from "@/lib/tenant-db";
import { recordAudit } from "@/lib/audit";
import { getIo } from "@/lib/realtime/emit";
import { rooms } from "@/lib/realtime/rooms";
import { toActionResult } from "./result";
import { ADMIN_PATH } from "@/lib/app-paths";

const schema = z.object({
  name: z.string().trim().max(80),
  profileTags: z.array(z.string().trim().min(1).max(30)).max(20),
  profileNote: z.string().trim().max(2000),
  blocked: z.boolean(),
});

export async function saveVisitorProfileAction(
  id: string,
  input: z.input<typeof schema>,
) {
  try {
    const admin = await requireAdmin();
    const prisma = await adminDb();
    const data = schema.parse(input);
    await prisma.visitor.update({
      where: { id },
      data: {
        ...data,
        name: data.name || null,
        profileNote: data.profileNote || null,
        profileTags: [...new Set(data.profileTags)],
      },
    });
    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "visitor.profile.update",
      targetType: "Visitor",
      targetId: id,
      meta: { blocked: data.blocked },
    });
    if (data.blocked) {
      getIo()?.to(rooms.visitor(id)).emit("session:revoked");
      getIo()?.in(rooms.visitor(id)).disconnectSockets(true);
    }
    revalidatePath("/admin/visitors");
    revalidatePath(`/admin/visitors/${id}`);
    revalidatePath(`${ADMIN_PATH}/visitors`);
    revalidatePath(`${ADMIN_PATH}/visitors/${id}`);
    return { ok: true as const };
  } catch (error) {
    return toActionResult(error);
  }
}
