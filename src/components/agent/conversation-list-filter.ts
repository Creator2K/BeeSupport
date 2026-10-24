import type { SerializedConversation } from "@/lib/realtime/types";
import type { WorkbenchFilters } from "./conversation-list-types";

export function filterConversations(
  conversations: SerializedConversation[],
  filters: WorkbenchFilters,
  meId: string,
) {
  return conversations.filter((conversation) => {
    if (filters.tab === "queue" && conversation.status !== "PENDING")
      return false;
    if (
      filters.tab === "mine" &&
      (conversation.assignedAgent?.id !== meId ||
        conversation.status === "CLOSED")
    ) {
      return false;
    }
    if (filters.tab === "all" && conversation.status === "CLOSED") return false;
    if (filters.tab === "closed" && conversation.status !== "CLOSED")
      return false;
    if (filters.siteId !== "all" && conversation.siteId !== filters.siteId) {
      return false;
    }
    if (filters.unreadOnly && conversation.unreadForAgent === 0) return false;
    if (filters.query) {
      const keyword = filters.query.trim().toLowerCase();
      const haystack = [
        conversation.visitor.email,
        conversation.visitor.name ?? "",
        conversation.lastMessagePreview ?? "",
        conversation.subject ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
}
