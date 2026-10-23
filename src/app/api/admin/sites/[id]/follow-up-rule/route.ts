import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { readJson, toErrorResponse } from "@/lib/api";
import { followUpRuleSchema } from "@/lib/follow-up-rules";
import {
  getFollowUpRule,
  saveFollowUpRule,
} from "@/server/services/follow-up-rules";

const headers = { "Cache-Control": "no-store" };
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json(
      await getFollowUpRule(await requireAdmin(), (await context.params).id),
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
      input = followUpRuleSchema.parse(await readJson(request));
    return NextResponse.json(
      { rule: await saveFollowUpRule(actor, (await context.params).id, input) },
      { headers },
    );
  } catch (error) {
    const response = toErrorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
