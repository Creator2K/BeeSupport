export type WorkbenchTab = "queue" | "mine" | "all" | "closed";

export type WorkbenchFilters = {
  tab: WorkbenchTab;
  siteId: string;
  query: string;
  unreadOnly: boolean;
};

export type ConversationListCounts = {
  pending: number;
  open: number;
  unread: number;
  mine: number;
};

export type ConversationSiteOption = { id: string; name: string };
