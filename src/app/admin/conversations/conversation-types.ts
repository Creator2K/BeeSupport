import type { SerializedConversation } from "@/lib/realtime/types";

export type AdminConversationItem = SerializedConversation;
export type SiteOption = { id: string; name: string };
export type ConversationFilters = {
  status: string;
  siteId: string;
  query: string;
};
