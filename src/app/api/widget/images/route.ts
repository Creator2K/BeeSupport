import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, toErrorResponse } from "@/lib/api";
import { HttpError } from "@/lib/auth";
import { verifyVisitorRequest } from "@/server/services/risk";
import {
  cancelUnsentImage,
  getImageGate,
} from "@/server/services/image-review";

export async function GET(request: Request) {
  try {
    const visitor = await verifyVisitorRequest(request.headers);
    if (!visitor) throw new HttpError(401, "访客身份已失效");
    return NextResponse.json(await getImageGate(visitor), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const visitor = await verifyVisitorRequest(request.headers);
    if (!visitor) throw new HttpError(401, "访客身份已失效");
    const input = z
      .object({ attachmentId: z.string().min(1).max(128) })
      .parse(await readJson(request));
    await cancelUnsentImage(visitor, input.attachmentId);
    return NextResponse.json(await getImageGate(visitor));
  } catch (error) {
    return toErrorResponse(error);
  }
}
