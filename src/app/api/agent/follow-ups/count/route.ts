import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api";
import { countDueFollowUps } from "@/server/services/follow-ups";
import { countUnansweredReminders } from "@/server/services/unanswered";
export async function GET() {
  try {
    const actor = await requireUser();
    const [due, unanswered] = await Promise.all([
      countDueFollowUps(actor),
      countUnansweredReminders(actor),
    ]);
    return NextResponse.json(
      { due, unanswered },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
