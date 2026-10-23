"use client";

import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { CannedRecord } from "./canned-types";

export function CannedListTable({
  items,
  total,
  onCreate,
  onEdit,
  onDelete,
}: {
  items: CannedRecord[];
  total: number;
  onCreate: () => void;
  onEdit: (item: CannedRecord) => void;
  onDelete: (item: CannedRecord) => void;
}) {
  const t = useT();

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          {t("common.total")} {total} {t("common.items")}
        </p>
        <Button size="sm" onClick={onCreate}>
          <Plus className="size-4" />
          <span className="ml-1.5">{t("canned.new")}</span>
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title={t("common.empty")}
          description={t("canned.subtitle")}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>{t("canned.titleLabel")}</TableHead>
                <TableHead className="hidden sm:table-cell">
                  {t("canned.shortcutLabel")}
                </TableHead>
                <TableHead className="hidden lg:table-cell">
                  {t("canned.scope")}
                </TableHead>
                <TableHead className="hidden md:table-cell">
                  {t("canned.usage")}
                </TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="min-w-0">
                      <div className="max-w-80 break-all text-sm font-medium">
                        {item.title}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="secondary" className="text-[11px]">
                          {item.category || t("canned.uncategorized")}
                        </Badge>
                        {!item.shared && (
                          <Badge variant="outline" className="text-[11px]">
                            {t("canned.private")}
                          </Badge>
                        )}
                      </div>
                      <div className="text-muted-foreground mt-1 line-clamp-1 max-w-80 break-all text-xs">
                        {item.content}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {item.shortcut ? (
                      <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-[11px]">
                        /{item.shortcut}
                      </code>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <Badge variant="secondary" className="text-[11px]">
                      {item.tenantName ? `${item.tenantName} / ` : ""}
                      {item.siteName ?? t("canned.scopeGlobal")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-xs tabular-nums md:table-cell">
                    {item.usageCount}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${t("common.edit")} ${item.title}`}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => onEdit(item)}>
                          <Pencil className="size-4" />
                          {t("common.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => onDelete(item)}
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
