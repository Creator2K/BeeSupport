import { NextResponse } from "next/server";
import { z } from "zod";

import { readJson, toErrorResponse } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import {
  claimConversation,
  closeConversation,
  reopenConversation,
  transferConversation,
} from "@/server/services/conversations";
import {
  markConversationRead,
  postInternalNote,
} from "@/server/services/messages";

/**
 * 会话上的各种「动作」集中在一个入口：
 * claim / transfer / close / reopen / read / note
 */
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim") }),
  z.object({
    action: z.literal("transfer"),
    targetAgentId: z.string().min(1),
  }),
  z.object({ action: z.literal("close") }),
  z.object({ action: z.literal("reopen") }),
  z.object({ action: z.literal("read") }),
  z.object({ action: z.literal("note"), body: z.string().min(1).max(2000) }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const input = actionSchema.parse(await readJson(request));

    switch (input.action) {
      case "claim": {
        const conversation = await claimConversation(user, id);
        return NextResponse.json({ ok: true, conversation });
      }
      case "transfer": {
        const conversation = await transferConversation(
          user,
          id,
          input.targetAgentId,
        );
        await recordAudit({
          actorId: user.id,
          actorName: user.name,
          action: "conversation.transfer",
          targetType: "Conversation",
          targetId: id,
          meta: { targetAgentId: input.targetAgentId },
        });
        return NextResponse.json({ ok: true, conversation });
      }
      case "close": {
        const conversation = await closeConversation(user, id);
        await recordAudit({
          actorId: user.id,
          actorName: user.name,
          action: "conversation.close",
          targetType: "Conversation",
          targetId: id,
        });
        return NextResponse.json({ ok: true, conversation });
      }
      case "reopen": {
        const conversation = await reopenConversation(user, id);
        return NextResponse.json({ ok: true, conversation });
      }
      case "read": {
        await markConversationRead({ conversationId: id, by: "AGENT", user });
        return NextResponse.json({ ok: true });
      }
      case "note": {
        const messageId = await postInternalNote({
          user,
          conversationId: id,
          body: input.body,
        });
        return NextResponse.json({ ok: true, messageId });
      }
      default:
        return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
