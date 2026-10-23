"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, History, Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { useT } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, formatRelative } from "@/lib/format";
import type {
  SerializedConversation,
  VisitorConversationSummary,
} from "@/lib/realtime/types";
import { describeVisitor } from "@/lib/visitor-env";
import { cn } from "@/lib/utils";

export function VisitorPanel({
  conversation,
  onUpdated,
  onOpenConversation,
  profileHref,
}: {
  conversation: SerializedConversation;
  onUpdated: (conversation: SerializedConversation) => void;
  onOpenConversation?: (conversationId: string) => void;
  profileHref?: string;
}) {
  const t = useT();
  const [tags, setTags] = useState<string[]>(conversation.tags);
  const [tagDraft, setTagDraft] = useState("");
  const [note, setNote] = useState(conversation.note ?? "");
  const [subject, setSubject] = useState(conversation.subject ?? "");
  const [priority, setPriority] = useState(String(conversation.priority));
  const [pending, setPending] = useState(false);

  const [history, setHistory] = useState<VisitorConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const serverDraft = useRef({
    note: conversation.note ?? "",
    subject: conversation.subject ?? "",
  });
  const tagsKey = JSON.stringify(conversation.tags);

  useEffect(() => {
    setTags(JSON.parse(tagsKey) as string[]);
  }, [tagsKey]);
  useEffect(() => {
    const previous = serverDraft.current;
    const next = {
      note: conversation.note ?? "",
      subject: conversation.subject ?? "",
    };
    setNote((draft) => (draft === previous.note ? next.note : draft));
    setSubject((draft) => (draft === previous.subject ? next.subject : draft));
    serverDraft.current = next;
  }, [conversation.note, conversation.subject]);
  useEffect(() => {
    setPriority(String(conversation.priority));
  }, [conversation.priority]);

  const visitor = conversation.visitor;
  const meta = (visitor.meta ?? {}) as Record<string, unknown>;
  const identity = describeVisitor(meta);

  function readMeta(key: string): string | null {
    const value = meta[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && value > 0) return String(value);
    if (typeof value === "boolean")
      return value ? t("common.yes") : t("common.no");
    return null;
  }

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await fetch(
        `/api/agent/conversations/${conversation.id}/history`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const data = (await response.json()) as {
        conversations?: VisitorConversationSummary[];
      };
      setHistory(data.conversations ?? []);
    } catch {
      toast.error(t("common.operationFailed"));
    } finally {
      setHistoryLoading(false);
    }
  }, [conversation.id, t]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function save(patch: {
    tags?: string[];
    note?: string;
    priority?: number;
    subject?: string;
  }): Promise<boolean> {
    setPending(true);
    try {
      const response = await fetch(
        `/api/agent/conversations/${conversation.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const data = (await response.json()) as {
        conversation?: SerializedConversation;
        error?: string;
      };
      if (!response.ok || !data.conversation) {
        toast.error(data.error ?? t("common.operationFailed"));
        return false;
      }
      onUpdated(data.conversation);
      return true;
    } catch {
      toast.error(t("common.operationFailed"));
      return false;
    } finally {
      setPending(false);
    }
  }

  async function addTag() {
    const value = tagDraft.trim();
    if (!value || tags.includes(value) || tags.length >= 12 || pending) return;
    const next = [...tags, value];
    if (await save({ tags: next }))
      setTagDraft((draft) => (draft.trim() === value ? "" : draft));
  }

  function removeTag(value: string) {
    if (pending) return;
    const next = tags.filter((tag) => tag !== value);
    void save({ tags: next });
  }

  const screen = readMeta("screen");
  const viewport = readMeta("viewport");
  const dpr = readMeta("dpr");

  return (
    <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l lg:flex">
      <div className="flex items-center justify-between border-b px-3 py-2.5">
        <h2 className="text-sm font-medium">{t("workbench.visitorInfo")}</h2>
      </div>

      <div className="space-y-3 p-3">
        {visitor.profileTags?.length ||
        visitor.profileNote ||
        visitor.blocked ||
        profileHref ? (
          <div className="space-y-2 rounded-md border p-2 text-xs">
            <div className="flex flex-wrap gap-1">
              {visitor.profileTags?.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-[10px]">
                  {tag}
                </Badge>
              ))}
              {visitor.blocked && (
                <span className="text-destructive">身份已封禁</span>
              )}
            </div>
            {visitor.profileNote && (
              <p className="whitespace-pre-wrap break-words text-muted-foreground">
                {visitor.profileNote}
              </p>
            )}
            {profileHref && (
              <a
                className="inline-block underline underline-offset-4"
                href={profileHref}
              >
                {t("nav.visitors")}
              </a>
            )}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <span className="bg-muted flex size-8 items-center justify-center rounded-full text-xs font-medium">
            {(visitor.name ?? visitor.email).slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm">
              {visitor.name ?? visitor.email}
            </div>
            <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  visitor.online ? "bg-emerald-500" : "bg-zinc-400",
                )}
              />
              {visitor.online
                ? t("workbench.visitorOnline")
                : t("workbench.lastActive", {
                    time: formatRelative(visitor.lastSeenAt),
                  })}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <Metric
            label={t("workbench.visitCount")}
            value={visitor.visitCount}
          />
          <Metric label={t("workbench.pageViews")} value={visitor.pageViews} />
          <Metric
            label={t("workbench.history")}
            value={history.length}
            suffix={history.length >= 15 ? "+" : ""}
          />
        </div>

        <div className="space-y-1.5 text-xs">
          <InfoRow label={t("common.email")} value={visitor.email} />
          <InfoRow label={t("common.site")} value={conversation.siteName} />
          <InfoRow
            label={t("workbench.firstSeen")}
            value={formatDateTime(visitor.firstSeenAt)}
          />
          <InfoRow
            label={t("workbench.lastActiveLabel")}
            value={formatDateTime(visitor.lastSeenAt)}
          />
          <InfoRow
            label={t("workbench.firstResponse")}
            value={
              conversation.firstResponseAt
                ? formatDateTime(conversation.firstResponseAt)
                : "—"
            }
          />
          <InfoRow
            label={t("workbench.conversationCount")}
            value={String(conversation.messageCount ?? "—")}
          />
        </div>

        <Separator />

        <div className="space-y-1.5 text-xs">
          {visitor.landingPage ? (
            <InfoRow
              label={t("workbench.landingPage")}
              value={shortUrl(visitor.landingPage)}
              href={visitor.landingPage}
            />
          ) : null}
          {visitor.lastPage ? (
            <InfoRow
              label={t("workbench.currentPage")}
              value={shortUrl(visitor.lastPage)}
              href={visitor.lastPage}
            />
          ) : null}
          {visitor.lastPageTitle ? (
            <InfoRow
              label={t("workbench.pageTitle")}
              value={visitor.lastPageTitle}
            />
          ) : null}
          {visitor.referrer ? (
            <InfoRow
              label={t("workbench.referrer")}
              value={shortUrl(visitor.referrer)}
              href={visitor.referrer}
            />
          ) : null}
        </div>

        <Separator />

        <div className="space-y-1.5 text-xs">
          {identity.device ? (
            <InfoRow label={t("workbench.device")} value={identity.device} />
          ) : null}
          {identity.os ? (
            <InfoRow label={t("workbench.os")} value={identity.os} />
          ) : null}
          {identity.browser ? (
            <InfoRow label={t("workbench.browser")} value={identity.browser} />
          ) : null}
          {screen ? (
            <InfoRow
              label={t("workbench.screen")}
              value={dpr ? `${screen} @${dpr}x` : screen}
            />
          ) : null}
          {viewport ? (
            <InfoRow label={t("workbench.viewport")} value={viewport} />
          ) : null}
          {readMeta("locale") ? (
            <InfoRow
              label={t("workbench.locale")}
              value={[readMeta("locale"), readMeta("languages")]
                .filter(Boolean)
                .join(" · ")}
            />
          ) : null}
          {readMeta("timezone") ? (
            <InfoRow
              label={t("workbench.timezone")}
              value={readMeta("timezone")!}
            />
          ) : null}
          {readMeta("connection") ? (
            <InfoRow
              label={t("workbench.network")}
              value={readMeta("connection")!}
            />
          ) : null}
          {readMeta("colorScheme") ? (
            <InfoRow
              label={t("workbench.colorScheme")}
              value={
                readMeta("colorScheme") === "dark"
                  ? t("workbench.colorDark")
                  : t("workbench.colorLight")
              }
            />
          ) : null}
          {readMeta("cpu") ? (
            <InfoRow
              label={t("workbench.hardware")}
              value={[
                readMeta("cpu") ? `${readMeta("cpu")} 核` : null,
                readMeta("memory") ? `${readMeta("memory")}GB 内存` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          ) : null}
          {readMeta("ip") ? (
            <InfoRow label={t("workbench.ipHint")} value={readMeta("ip")!} />
          ) : null}
          {readMeta("ua") ? (
            <InfoRow label={t("workbench.userAgent")} value={readMeta("ua")!} />
          ) : null}
        </div>

        <Separator />

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">{t("workbench.history")}</Label>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-6"
              onClick={() => void loadHistory()}
              title={t("common.refresh")}
            >
              <RefreshCw
                className={cn("size-3", historyLoading && "animate-spin")}
              />
            </Button>
          </div>

          {history.length === 0 ? (
            <p className="text-muted-foreground text-[11px]">
              {t("workbench.historyEmpty")}
            </p>
          ) : (
            <div className="max-h-52 space-y-1 overflow-y-auto pr-0.5">
              {history.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpenConversation?.(item.id)}
                  className="hover:bg-accent w-full rounded-md border px-2 py-1.5 text-left transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <History className="text-muted-foreground size-3 shrink-0" />
                    <span className="flex-1 truncate text-[11px]">
                      {item.subject ||
                        item.lastMessagePreview ||
                        item.id.slice(0, 8)}
                    </span>
                    <Badge
                      variant="secondary"
                      className="h-4 shrink-0 px-1 text-[10px]"
                    >
                      {item.status === "CLOSED"
                        ? t("conversations.statusClosed")
                        : item.status === "PENDING"
                          ? t("conversations.statusPending")
                          : t("conversations.statusOpen")}
                    </Badge>
                  </span>
                  <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[10px]">
                    <span>{formatDateTime(item.createdAt)}</span>
                    <span>·</span>
                    <span>{item.messageCount}</span>
                    {item.agentName ? (
                      <>
                        <span>·</span>
                        <span className="truncate">{item.agentName}</span>
                      </>
                    ) : null}
                    {item.rating ? (
                      <>
                        <span>·</span>
                        <span>{"★".repeat(item.rating)}</span>
                      </>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-2">
          <Label htmlFor="conversation-subject" className="text-xs">
            {t("common.subject")}
          </Label>
          <div className="flex gap-1.5">
            <Input
              id="conversation-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              className="h-8 text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t("common.save")}
              disabled={pending}
              onClick={() => void save({ subject })}
            >
              <Check className="size-3.5" />
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">{t("common.tags")}</Label>
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="gap-1 text-[11px]"
              >
                {tag}
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`${t("common.delete")}: ${tag}`}
                  onClick={() => removeTag(tag)}
                >
                  <X className="size-2.5" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-1.5">
            <Input
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTag();
                }
              }}
              placeholder={t("workbench.tagsPlaceholder")}
              className="h-8 text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={pending}
              aria-label={t("common.tags")}
              onClick={() => void addTag()}
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">{t("workbench.priorityLabel")}</Label>
          <Select
            value={priority}
            onValueChange={(value) => {
              void save({ priority: Number(value) });
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full"
              disabled={pending}
              aria-label={t("workbench.priorityLabel")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{t("common.none")}</SelectItem>
              <SelectItem value="1">P1</SelectItem>
              <SelectItem value="2">P2</SelectItem>
              <SelectItem value="3">P3</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">{t("workbench.note")}</Label>
          <Textarea
            value={note}
            rows={3}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("workbench.notePlaceholder")}
            className="text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            disabled={pending}
            onClick={async () => {
              if (await save({ note })) toast.success(t("workbench.noteSaved"));
            }}
          >
            {t("workbench.noteAdd")}
          </Button>
        </div>

        {conversation.rating ? (
          <>
            <Separator />
            <div className="space-y-1">
              <Label className="text-xs">{t("workbench.ratingLabel")}</Label>
              <div className="text-sm">
                {"★".repeat(conversation.rating)}
                {"☆".repeat(5 - conversation.rating)}
              </div>
              {conversation.ratingComment ? (
                <p className="text-muted-foreground text-xs">
                  {conversation.ratingComment}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
}

function Metric({
  label,
  value,
  suffix = "",
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div className="bg-muted/50 rounded-md px-2 py-1.5 text-center">
      <div className="text-sm font-medium tabular-nums">
        {value}
        {suffix}
      </div>
      <div className="text-muted-foreground text-[10px]">{label}</div>
    </div>
  );
}

/** 长 URL 只留域名 + 尾部路径，够客服判断来路 */
function shortUrl(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname === "/" ? "" : url.pathname;
    const text = `${url.host}${path}${url.search}`;
    return text.length > 46 ? `${text.slice(0, 44)}…` : text;
  } catch {
    return value.length > 46 ? `${value.slice(0, 44)}…` : value;
  }
}

function InfoRow({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground w-20 shrink-0">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 truncate underline underline-offset-2"
          title={value}
        >
          {value}
        </a>
      ) : (
        <span className="min-w-0 flex-1 truncate" title={value}>
          {value}
        </span>
      )}
    </div>
  );
}
