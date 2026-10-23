import { NextResponse } from "next/server";
import type { MessageType } from "@prisma/client";
import { z } from "zod";

import { readJson, toErrorResponse } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { postAgentMessage } from "@/server/services/messages";

const bodySchema = z.object({
  body: z.string().max(5000).default(""),
  type: z.enum(["TEXT", "IMAGE", "FILE"]).optional(),
  clientId: z.string().trim().min(1).max(64).optional(),
  attachmentIds: z.array(z.string().min(1)).max(10).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const input = bodySchema.parse(await readJson(request));

    const messageId = await postAgentMessage({
      user,
      conversationId: id,
      body: input.body,
      type: input.type as MessageType | undefined,
      clientId: input.clientId ?? null,
      attachmentIds: input.attachmentIds ?? [],
    });

    return NextResponse.json({ ok: true, messageId });
  } catch (error) {
    return toErrorResponse(error);
  }
}
