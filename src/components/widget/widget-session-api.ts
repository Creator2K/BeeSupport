import type { VisitorConversation } from "@/lib/realtime/public";
import type { SerializedMessage } from "@/lib/realtime/types";

type WidgetState = {
  conversation: VisitorConversation | null;
  messages: SerializedMessage[];
};

/** 同 fetchWidgetState，另外带回 HTTP 状态码（网络失败为 0），调用方能区分「令牌失效」和临时故障 */
export async function requestWidgetState(
  visitorToken: string,
  conversationId?: string | null,
  before?: string,
): Promise<{ state: WidgetState | null; status: number }> {
  try {
    const params = new URLSearchParams();
    if (conversationId) params.set("conversationId", conversationId);
    if (before) params.set("before", before);
    const response = await fetch(`/api/widget/conversation?${params}`, {
      headers: { authorization: `Bearer ${visitorToken}` },
      cache: "no-store",
    });
    if (!response.ok) return { state: null, status: response.status };
    return {
      state: (await response.json()) as WidgetState,
      status: response.status,
    };
  } catch {
    return { state: null, status: 0 };
  }
}

export async function fetchWidgetState(
  visitorToken: string,
  conversationId?: string | null,
  before?: string,
): Promise<WidgetState | null> {
  return (await requestWidgetState(visitorToken, conversationId, before)).state;
}
