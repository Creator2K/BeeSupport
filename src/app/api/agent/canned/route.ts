import { NextResponse } from "next/server";
import { readJson, toErrorResponse } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { cannedSearchSchema, useCannedSchema } from "@/lib/canned";
import { listCannedForAgent, recordCannedUse } from "@/server/services/canned";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const filters = cannedSearchSchema.parse({
      query: url.searchParams.get("query") ?? "",
      category: url.searchParams.get("category") ?? "",
      siteId: url.searchParams.get("siteId") ?? "",
    });
    return NextResponse.json(await listCannedForAgent(user, filters), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const { id, siteId } = useCannedSchema.parse(await readJson(request));
    const item = await recordCannedUse(user, id, siteId);
    return NextResponse.json(
      { ok: true, item },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
