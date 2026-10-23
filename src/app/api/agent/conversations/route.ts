import { NextResponse } from "next/server";
import type { ConversationStatus } from "@prisma/client";

import { toErrorResponse } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import {
  conversationCounts,
  listConversations,
} from "@/server/services/conversations";

const STATUSES: ConversationStatus[] = ["PENDING", "OPEN", "CLOSED"];

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const url = new URL(request.url);

    const statusParam = url.searchParams.get("status");
    const status =
      statusParam && STATUSES.includes(statusParam as ConversationStatus)
        ? (statusParam as ConversationStatus)
        : undefined;

    const assignedToParam = url.searchParams.get("assignedTo");
    const assignedTo =
      assignedToParam === "me" ||
      assignedToParam === "unassigned" ||
      assignedToParam === "all"
        ? assignedToParam
        : undefined;

    const siteId = url.searchParams.get("siteId") ?? undefined;

    const [result, counts] = await Promise.all([
      listConversations(user, {
        status,
        siteId,
        assignedTo,
        query: url.searchParams.get("query") ?? undefined,
        tag: url.searchParams.get("tag") ?? undefined,
        onlyUnread: url.searchParams.get("unread") === "1",
        excludeClosed: url.searchParams.get("active") === "1",
        page: Number(url.searchParams.get("page") ?? 1),
        pageSize: Number(url.searchParams.get("pageSize") ?? 30),
      }),
      conversationCounts(user, siteId),
    ]);

    return NextResponse.json({ ...result, counts });
  } catch (error) {
    return toErrorResponse(error);
  }
}
