"use client";

import {
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Send,
  Trash2,
} from "lucide-react";

import { EmptyState } from "@/components/admin/page-header";
import { useT } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  EVENT_OPTIONS,
  TYPE_LABELS,
  type WebhookRecord,
} from "./webhook-types";

type WebhookListProps = {
  endpoints: WebhookRecord[];
  testingId: string | null;
  onNew: () => void;
  onEdit: (endpoint: WebhookRecord) => void;
  onTest: (endpoint: WebhookRecord) => void;
  onDelete: (endpoint: WebhookRecord) => void;
  onToggle: (endpoint: WebhookRecord, active: boolean) => void;
};

export function WebhookList({
  endpoints,
  testingId,
  onNew,
  onEdit,
  onTest,
  onDelete,
  onToggle,
}: WebhookListProps) {
  const t = useT();

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          {t("common.total")} {endpoints.length} {t("common.items")}
        </p>
        <Button size="sm" onClick={onNew}>
          <Plus className="size-4" />
          <span className="ml-1.5">{t("webhooks.new")}</span>
        </Button>
      </div>

      {endpoints.length === 0 ? (
        <EmptyState
          title={t("common.empty")}
          description={t("webhooks.subtitle")}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>{t("common.name")}</TableHead>
                <TableHead className="hidden sm:table-cell">
                  {t("webhooks.typeLabel")}
                </TableHead>
                <TableHead className="hidden lg:table-cell">
                  {t("webhooks.eventsLabel")}
                </TableHead>
                <TableHead className="hidden xl:table-cell">
                  {t("webhooks.lastStatus")}
                </TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {endpoints.map((endpoint) => (
                <TableRow key={endpoint.id}>
                  <TableCell>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {endpoint.name}
                      </div>
                      <div className="text-muted-foreground truncate text-xs">
                        {endpoint.siteName ?? t("webhooks.siteScopeAll")}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant="secondary" className="text-[11px]">
                      {t(TYPE_LABELS[endpoint.type])}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <span className="text-muted-foreground text-xs">
                      {endpoint.events.length === 0
                        ? t("webhooks.eventsHint")
                        : endpoint.events
                            .map((event) =>
                              t(
                                EVENT_OPTIONS.find(
                                  (item) => item.value === event,
                                )?.labelKey ?? "webhooks.eventsLabel",
                              ),
                            )
                            .join("?")}
                    </span>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    {endpoint.lastStatus ? (
                      <span
                        className={`text-xs ${endpoint.lastStatus.startsWith("error") ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        {endpoint.lastStatus.slice(0, 40)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        {t("common.never")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      aria-label={`${t("common.enabled")}: ${endpoint.name}`}
                      checked={endpoint.active}
                      onCheckedChange={(checked) => onToggle(endpoint, checked)}
                    />
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => onEdit(endpoint)}>
                          <Pencil className="size-4" />
                          {t("common.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={testingId === endpoint.id}
                          onSelect={() => onTest(endpoint)}
                        >
                          {testingId === endpoint.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Send className="size-4" />
                          )}
                          {t("webhooks.test")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => onDelete(endpoint)}
                        >
                          <Trash2 className="size-4" />
                          {t("common.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
