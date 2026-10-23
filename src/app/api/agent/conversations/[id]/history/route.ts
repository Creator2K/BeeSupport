import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { getVisitorProfileForAgent } from "@/server/services/conversations";

/** 访客档案与历史会话（工作台访客面板） */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const data = await getVisitorProfileForAgent(user, id);
    return NextResponse.json(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
