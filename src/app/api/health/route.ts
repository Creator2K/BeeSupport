import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness deliberately does not depend on the database or optional services. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { status: "ok" },
    { headers: { "cache-control": "no-store" } },
  );
}
