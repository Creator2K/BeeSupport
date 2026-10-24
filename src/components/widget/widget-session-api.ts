import type { VisitorConversation } from "@/lib/realtime/public";
import type { SerializedMessage } from "@/lib/realtime/types";

export async function fetchWidgetState(
  visitorToken: string,
  conversationId?: string | null,
  before?: string,
): Promise<{
  conversation: VisitorConversation | null;
  messages: SerializedMessage[];
} | null> {
  try {
    const params = new URLSearchParams();
    if (conversationId) params.set("conversationId", conversationId);
    if (before) params.set("before", before);
    const response = await fetch(`/api/widget/conversation?${params}`, {
      headers: { authorization: `Bearer ${visitorToken}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as {
      conversation: VisitorConversation | null;
      messages: SerializedMessage[];
    };
  } catch {
    return null;
  }
}