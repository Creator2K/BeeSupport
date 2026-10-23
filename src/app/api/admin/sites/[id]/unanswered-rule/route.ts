import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { readJson, toErrorResponse } from "@/lib/api";
import { unansweredRuleSchema } from "@/lib/unanswered";
import {
  getUnansweredRule,
  saveUnansweredRule,
} from "@/server/services/unanswered";
const headers = { "Cache-Control": "no-store" };
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json(
      await getUnansweredRule(await requireAdmin(), (await context.params).id),
      { headers },
    );
  } catch (error) {
    const response = toErrorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireAdmin(),
      input = unansweredRuleSchema.parse(await readJson(request));
    return NextResponse.json(
      {
        rule: await saveUnansweredRule(actor, (await context.params).id, input),
      },
      { headers },
    );
  } catch (error) {
    const response = toErrorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
