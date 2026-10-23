"use client";

import { useT } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { SerializedConversation } from "@/lib/realtime/types";
import { describeVisitor } from "@/lib/visitor-env";
import { cn } from "@/lib/utils";

import { InfoRow, Metric, shortUrl } from "./visitor-panel-shared";

type VisitorProfileSectionProps = {
  conversation: SerializedConversation;
  historyCount: number;
  profileHref?: string;
};

export function VisitorProfileSection({
  conversation,
  historyCount,
  profileHref,
}: VisitorProfileSectionProps) {
  const t = useT();
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

  const screen = readMeta("screen");
  const viewport = readMeta("viewport");
  const dpr = readMeta("dpr");

  return (
    <>
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
            <p className="text-muted-foreground whitespace-pre-wrap break-words">
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
        <Metric label={t("workbench.visitCount")} value={visitor.visitCount} />
        <Metric label={t("workbench.pageViews")} value={visitor.pageViews} />
        <Metric
          label={t("workbench.history")}
          value={historyCount}
          suffix={historyCount >= 15 ? "+" : ""}
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
              : "?"
          }
        />
        <InfoRow
          label={t("workbench.conversationCount")}
          value={String(conversation.messageCount ?? "?")}
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
              .join(" ? ")}
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
              .join(" ? ")}
          />
        ) : null}
        {readMeta("ip") ? (
          <InfoRow label={t("workbench.ipHint")} value={readMeta("ip")!} />
        ) : null}
        {readMeta("ua") ? (
          <InfoRow label={t("workbench.userAgent")} value={readMeta("ua")!} />
        ) : null}
      </div>
    </>
  );
}
