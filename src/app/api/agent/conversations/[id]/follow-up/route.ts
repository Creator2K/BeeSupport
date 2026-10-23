import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { readJson, toErrorResponse } from "@/lib/api";
import { followUpActionSchema } from "@/lib/follow-ups";
import {
  getFollowUpDetails,
  changeFollowUp,
} from "@/server/services/follow-ups";
const headers = { "Cache-Control": "no-store" };
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json(
      await getFollowUpDetails(await requireUser(), (await context.params).id),
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
    const actor = await requireUser();
    const input = followUpActionSchema.parse(await readJson(request));
    const task = await changeFollowUp(actor, (await context.params).id, input);
    return NextResponse.json({ task }, { headers });
  } catch (error) {
    const response = toErrorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
