import { NextResponse } from "next/server";
import { z } from "zod";

import { readJson, toErrorResponse } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import {
  getConversationForAgent,
  updateConversationMeta,
} from "@/server/services/conversations";

const patchSchema = z.object({
  tags: z.array(z.string().trim().min(1).max(24)).max(12).optional(),
  note: z.string().max(2000).optional(),
  priority: z.number().int().min(0).max(9).optional(),
  subject: z.string().max(200).optional(),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const data = await getConversationForAgent(
      user,
      id,
      new URL(request.url).searchParams.get("before") ?? undefined,
    );
    return NextResponse.json(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const input = patchSchema.parse(await readJson(request));
    const conversation = await updateConversationMeta(user, id, input);
    return NextResponse.json({ conversation });
  } catch (error) {
    return toErrorResponse(error);
  }
}
