"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ConversationDetailDialog } from "./conversation-detail-dialog";
import { ConversationFilters } from "./conversation-filters";
import { ConversationListTable } from "./conversation-list-table";
import type {
  AdminConversationItem,
  ConversationFilters as ConversationFiltersValue,
  SiteOption,
} from "./conversation-types";

export type { AdminConversationItem, SiteOption } from "./conversation-types";

export function ConversationsClient({
  adminPath,
  items,
  total,
  page,
  pageSize,
  sites,
  filters,
}: {
  adminPath: string;
  items: AdminConversationItem[];
  total: number;
  page: number;
  pageSize: number;
  sites: SiteOption[];
  filters: ConversationFiltersValue;
}) {
  const router = useRouter();
  const [detailId, setDetailId] = useState<string | null>(null);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function applyFilters(patch: Partial<ConversationFiltersValue>) {
    const next = { ...filters, ...patch };
    const search = new URLSearchParams();
    if (next.status) search.set("status", next.status);
    if (next.siteId) search.set("siteId", next.siteId);
    if (next.query) search.set("query", next.query);
    search.set("page", "1");
    router.push(`${adminPath}/conversations?${search.toString()}`);
  }

  function goToPage(next: number) {
    const search = new URLSearchParams();
    if (filters.status) search.set("status", filters.status);
    if (filters.siteId) search.set("siteId", filters.siteId);
    if (filters.query) search.set("query", filters.query);
    search.set("page", String(next));
    router.push(`${adminPath}/conversations?${search.toString()}`);
  }

  return (
    <div className="space-y-4">
      <ConversationFilters
        filters={filters}
        sites={sites}
        total={total}
        onApply={applyFilters}
      />
      <ConversationListTable
        items={items}
        page={page}
        totalPages={totalPages}
        onOpen={setDetailId}
        onPageChange={goToPage}
      />
      <ConversationDetailDialog
        key={detailId ?? "closed"}
        conversationId={detailId}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
}
