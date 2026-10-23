import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { approveImage } from "@/server/services/image-review";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const result = await approveImage(user, id);
    if (result.changed)
      await recordAudit({
        actorId: user.id,
        actorName: user.name,
        action: "image.allow-next",
        targetType: "Attachment",
        targetId: id,
      });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
