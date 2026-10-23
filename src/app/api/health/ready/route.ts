import { NextResponse } from "next/server";
import { checkReadiness } from "@/server/health";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const result = await checkReadiness();
  return NextResponse.json(result, {
    status: result.status === "ok" ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
