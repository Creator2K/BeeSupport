import { NextResponse } from "next/server";
import { z } from "zod";

import { readJson, toErrorResponse } from "@/lib/api";
import { AiError } from "@/lib/ai";
import { HttpError, requireUser } from "@/lib/auth";
import { suggestAgentReply } from "@/server/services/ai";

const errorResponse = (error: unknown): NextResponse => {
  if (error instanceof AiError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof HttpError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }
  return toErrorResponse(error);
};

const bodySchema = z.object({
  /** 工作台可临时指定模型（必须在后台配置的模型清单里） */
  model: z.string().trim().max(200).optional(),
});

/** 客服工作台：让 AI 生成一条建议回复（只返回文本，不落库） */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const input = bodySchema.parse(await readJson(request, true));

    const result = await suggestAgentReply({
      user,
      conversationId: id,
      model: input.model,
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
