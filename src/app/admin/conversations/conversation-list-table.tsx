"use client";

import { Star } from "lucide-react";

import { EmptyState } from "@/components/admin/page-header";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";

import type { AdminConversationItem } from "./conversation-types";

function StatusPill({ status }: { status: "PENDING" | "OPEN" | "CLOSED" }) {
  const t = useT();
  const map = {
    PENDING: {
      labelKey: "conversations.statusPending" as const,
      className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    },
    OPEN: {
      labelKey: "conversations.statusOpen" as const,
      className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    },
    CLOSED: {
      labelKey: "conversations.statusClosed" as const,
      className: "bg-muted text-muted-foreground",
    },
  };
  const item = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${item.className}`}
    >
      {t(item.labelKey)}
    </span>
  );
}

export function ConversationListTable({
  items,
  page,
  totalPages,
  onOpen,
  onPageChange,
}: {
  items: AdminConversationItem[];
  page: number;
  totalPages: number;
  onOpen: (id: string) => void;
  onPageChange: (page: number) => void;
}) {
  const t = useT();

  return (
    <>
      {items.length === 0 ? (
        <EmptyState
          title={t("common.empty")}
          description={t("conversations.subtitle")}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>{t("conversations.visitor")}</TableHead>
                <TableHead className="hidden sm:table-cell">
                  {t("common.site")}
                </TableHead>
                <TableHead className="hidden lg:table-cell">
                  {t("conversations.assignedAgent")}
                </TableHead>
                <TableHead className="hidden xl:table-cell">
                  {t("conversations.messageCount")}
                </TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="hidden text-right md:table-cell">
                  {t("conversations.lastMessage")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow
                  key={item.id}
                  className="cursor-pointer"
                  onClick={() => onOpen(item.id)}
                >
                  <TableCell>
                    <div className="min-w-0">
                      <div className="truncate text-sm">
                        {item.visitor.name ?? item.visitor.email}
                      </div>
                      <div className="text-muted-foreground truncate text-xs">
                        {item.visitor.email}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">
                    {item.siteName}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-sm lg:table-cell">
                    {item.assignedAgent?.name ?? t("conversations.unassigned")}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-xs tabular-nums xl:table-cell">
                    {item.messageCount ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <StatusPill status={item.status} />
                      {item.rating ? (
                        <span className="text-muted-foreground inline-flex items-center gap-0.5 text-[11px]">
                          <Star className="size-3 fill-amber-400 text-amber-400" />
                          {item.rating}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-right text-xs whitespace-nowrap md:table-cell">
                    {formatDateTime(item.lastMessageAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            {t("common.back")}
          </Button>
          <span className="text-muted-foreground text-xs tabular-nums">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            {t("overview.viewAll")}
          </Button>
        </div>
      ) : null}
    </>
  );
}
