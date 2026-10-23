"use client";

import {
  Code2,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { CopyButton } from "@/components/admin/copy-button";
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
import { accentGradient, readableTextColor } from "@/lib/color";

import type { SiteRecord } from "./site-types";

export function SiteTable({
  sites,
  pendingId,
  onCreate,
  onEdit,
  onToggle,
  onEmbed,
  onDelete,
}: {
  sites: SiteRecord[];
  pendingId: string | null;
  onCreate: () => void;
  onEdit: (site: SiteRecord) => void;
  onToggle: (site: SiteRecord, active: boolean) => void;
  onEmbed: (site: SiteRecord) => void;
  onDelete: (site: SiteRecord) => void;
}) {
  const t = useT();

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          {t("common.total")} {sites.length} {t("common.items")}
        </p>
        <Button size="sm" onClick={onCreate}>
          <Plus className="size-4" />
          <span className="ml-1.5">{t("sites.new")}</span>
        </Button>
      </div>

      {sites.length === 0 ? (
        <EmptyState
          title={t("common.empty")}
          description={t("sites.subtitle")}
          action={
            <Button size="sm" onClick={onCreate}>
              <Plus className="size-4" />
              <span className="ml-1.5">{t("sites.new")}</span>
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>{t("sites.nameLabel")}</TableHead>
                <TableHead className="hidden sm:table-cell">
                  {t("sites.publicKey")}
                </TableHead>
                <TableHead className="hidden lg:table-cell">
                  {t("sites.allowedOrigins")}
                </TableHead>
                <TableHead className="hidden md:table-cell">
                  {t("nav.conversations")}
                </TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sites.map((site) => (
                <TableRow key={site.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <span
                        className="flex size-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold ring-1 ring-black/5 transition-transform duration-200 group-hover:scale-105 dark:ring-white/10"
                        style={{
                          background: accentGradient(site.primaryColor),
                          color: readableTextColor(site.primaryColor),
                        }}
                      >
                        {site.name.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {site.name}
                        </div>
                        <div className="text-muted-foreground truncate text-xs">
                          {site.slug}
                          {site.description ? ` · ${site.description}` : ""}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex items-center gap-1">
                      <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-[11px]">
                        {site.publicKey.slice(0, 14)}…
                      </code>
                      <CopyButton value={site.publicKey} />
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {site.allowedOrigins.length === 0 ? (
                      <Badge variant="secondary" className="text-[11px]">
                        {t("common.all")}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        {site.allowedOrigins.join(", ")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {site.counts.conversations}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={site.active}
                      disabled={pendingId === site.id}
                      onCheckedChange={(checked) => onToggle(site, checked)}
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
                        <DropdownMenuItem onSelect={() => onEdit(site)}>
                          <Pencil className="size-4" />
                          {t("common.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onEmbed(site)}>
                          <Code2 className="size-4" />
                          {t("sites.embedCode")}
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <a
                            href={`/preview?key=${encodeURIComponent(site.publicKey)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink className="size-4" />
                            {t("sites.testOpen")}
                          </a>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => onDelete(site)}
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
