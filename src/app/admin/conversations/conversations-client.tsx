"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, Star } from "lucide-react";

import { EmptyState } from "@/components/admin/page-header";
import { useT } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { mergeMessages } from "@/lib/realtime/messages";
import { useChatScroll } from "@/lib/realtime/use-chat-scroll";
import { formatDateTime, formatBytes } from "@/lib/format";
import type {
  SerializedConversation,
  SerializedMessage,
} from "@/lib/realtime/types";

export type AdminConversationItem = SerializedConversation;
export type SiteOption = { id: string; name: string };

const STATUS_OPTIONS = [
  { value: "__all__", labelKey: "common.all" },
  { value: "PENDING", labelKey: "conversations.statusPending" },
  { value: "OPEN", labelKey: "conversations.statusOpen" },
  { value: "CLOSED", labelKey: "conversations.statusClosed" },
] as const;

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
  filters: { status: string; siteId: string; query: string };
}) {
  const t = useT();
  const router = useRouter();
  const [query, setQuery] = useState(filters.query);
  const [detailId, setDetailId] = useState<string | null>(null);

  function applyFilters(patch: Partial<typeof filters>) {
    const next = { ...filters, ...patch };
    const search = new URLSearchParams();
    if (next.status) search.set("status", next.status);
    if (next.siteId) search.set("siteId", next.siteId);
    if (next.query) search.set("query", next.query);
    search.set("page", "1");
    router.push(`${adminPath}/conversations?${search.toString()}`);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative flex-1 sm:max-w-xs"
          onSubmit={(event) => {
            event.preventDefault();
            applyFilters({ query });
          }}
        >
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("conversations.searchPlaceholder")}
            className="h-8 pl-8 text-sm"
          />
        </form>

        <Select
          value={filters.status || "__all__"}
          onValueChange={(value) =>
            applyFilters({ status: value === "__all__" ? "" : value })
          }
        >
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.siteId || "__all__"}
          onValueChange={(value) =>
            applyFilters({ siteId: value === "__all__" ? "" : value })
          }
        >
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("common.all")}</SelectItem>
            {sites.map((site) => (
              <SelectItem key={site.id} value={site.id}>
                {site.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-muted-foreground ml-auto text-xs">
          {t("common.total")} {total} {t("common.items")}
        </span>
      </div>

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
                  onClick={() => setDetailId(item.id)}
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
            onClick={() => goToPage(page - 1)}
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
            onClick={() => goToPage(page + 1)}
          >
            {t("overview.viewAll")}
          </Button>
        </div>
      ) : null}

      <ConversationDetailDialog
        key={detailId ?? "closed"}
        conversationId={detailId}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
}

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

function ConversationDetailDialog({
  conversationId,
  onClose,
}: {
  conversationId: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [conversation, setConversation] =
    useState<SerializedConversation | null>(null);
  const [messages, setMessages] = useState<SerializedMessage[]>([]);

  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState(false);
  const [failedBefore, setFailedBefore] = useState<string | undefined>();
  const requestRef = useRef<AbortController | null>(null);
  const { scrollRef, onScroll, preserveHistoryPosition } = useChatScroll({
    conversationId,
    messageCount: messages.length,
    lastMessageId: messages.at(-1)?.id,
  });
  const loadPage = useCallback(
    async (before?: string) => {
      if (!conversationId || requestRef.current) return;
      const controller = new AbortController();
      requestRef.current = controller;
      if (before) setLoadingOlder(true);
      else setLoading(true);
      setError(false);
      try {
        const query = before ? `?before=${encodeURIComponent(before)}` : "";
        const response = await fetch(
          `/api/agent/conversations/${conversationId}${query}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error("Conversation unavailable");
        const data = (await response.json()) as {
          conversation: SerializedConversation;
          messages: SerializedMessage[];
        };
        if (controller.signal.aborted) return;
        if (before) preserveHistoryPosition();
        setConversation(data.conversation);
        setMessages((previous) =>
          before ? mergeMessages(previous, data.messages) : data.messages,
        );
        setHasOlder(data.messages.length === 200);
      } catch {
        if (!controller.signal.aborted) {
          setError(true);
          setFailedBefore(before);
        }
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
          setLoading(false);
          setLoadingOlder(false);
        }
      }
    },
    [conversationId, preserveHistoryPosition],
  );

  useEffect(() => {
    void loadPage();
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [loadPage]);

  return (
    <Dialog
      open={Boolean(conversationId)}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="max-h-[90dvh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("conversations.detail")}</DialogTitle>
          <DialogDescription>
            {conversation
              ? `${conversation.siteName} · ${conversation.visitor.email}`
              : t("common.loading")}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{t("common.operationFailed")}</p>
            <Button
              variant="outline"
              onClick={() => void loadPage(failedBefore)}
            >
              {t("common.retry")}
            </Button>
          </div>
        ) : null}
        {loading ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {t("conversations.loadingMessages")}
          </div>
        ) : (
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="max-h-[60dvh] space-y-3 overflow-y-auto pr-1"
          >
            {hasOlder ? (
              <Button
                variant="outline"
                className="w-full"
                disabled={loadingOlder}
                onClick={() => void loadPage(messages[0]?.id)}
              >
                {loadingOlder ? t("common.loading") : t("common.loadOlder")}
              </Button>
            ) : null}
            {conversation?.subject ? (
              <p className="text-sm font-medium">{conversation.subject}</p>
            ) : null}

            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.sender === "SYSTEM"
                    ? "text-center"
                    : message.sender === "AGENT"
                      ? "flex justify-end"
                      : "flex justify-start"
                }
              >
                {message.sender === "SYSTEM" ? (
                  <span className="text-muted-foreground text-xs">
                    {message.body}
                  </span>
                ) : (
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      message.sender === "AGENT"
                        ? "bg-primary text-primary-foreground"
                        : message.type === "NOTE"
                          ? "bg-amber-500/10 text-amber-800 dark:text-amber-300"
                          : "bg-muted"
                    }`}
                  >
                    <div className="chat-text">{message.body}</div>
                    {message.attachments.length > 0 ? (
                      <div className="mt-2 space-y-1">
                        {message.attachments.map((attachment) => (
                          <a
                            key={attachment.id}
                            href={attachment.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block text-xs underline underline-offset-2"
                          >
                            {attachment.filename} ·{" "}
                            {formatBytes(attachment.size)}
                          </a>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-1 text-[10px] opacity-60">
                      {formatDateTime(message.createdAt)}
                      {message.type === "NOTE"
                        ? ` · ${t("workbench.internalNote")}`
                        : ""}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {conversation?.rating ? (
          <div className="border-t pt-3">
            <Badge variant="secondary" className="text-[11px]">
              {t("conversations.rating")} {conversation.rating}/5
            </Badge>
            {conversation.ratingComment ? (
              <p className="text-muted-foreground mt-1.5 text-xs">
                {conversation.ratingComment}
              </p>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
