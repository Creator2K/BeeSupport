"use client";

import { callClientAction } from "@/lib/client-action";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Code2,
  ExternalLink,
  Globe,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { CopyButton } from "@/components/admin/copy-button";
import { EmptyState } from "@/components/admin/page-header";
import { useT } from "@/components/locale-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  deleteSiteAction,
  toggleSiteActiveAction,
} from "@/server/actions/sites";
import { accentGradient, readableTextColor } from "@/lib/color";

import type { WidgetSettings, EffectiveWidgetSettings } from "@/lib/branding";
import { SiteFormDialog } from "./site-form-dialog";

export type SiteRecord = {
  canCustomizeFooter: boolean;
  widgetSettings: WidgetSettings;
  inheritedSettings: EffectiveWidgetSettings;
  id: string;
  name: string;
  slug: string;
  publicKey: string;
  description: string | null;
  primaryColor: string;
  position: string;
  welcomeMessage: string;
  offlineMessage: string;
  requireEmail: boolean;
  autoAssign: boolean;
  imageReviewEnabled: boolean;
  notifyEmail: string | null;
  allowedOrigins: string[];
  workHours: unknown;
  active: boolean;
  counts: { conversations: number; visitors: number; agents: number };
  agentNames: string[];
};

export function SitesClient({
  sites,
  appUrl,
  defaultSettings,
  canCustomizeFooter = true,
}: {
  defaultSettings: EffectiveWidgetSettings;
  canCustomizeFooter?: boolean;
  sites: SiteRecord[];
  appUrl: string;
}) {
  const t = useT();
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SiteRecord | null>(null);
  const [embedSite, setEmbedSite] = useState<SiteRecord | null>(null);
  const [deleting, setDeleting] = useState<SiteRecord | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function handleToggle(site: SiteRecord, active: boolean) {
    setPendingId(site.id);
    const result = await callClientAction(
      () => toggleSiteActiveAction(site.id, active),
      t("common.operationFailed"),
    );
    setPendingId(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(active ? t("common.enabled") : t("common.disabled"));
    router.refresh();
  }

  async function handleDelete() {
    if (!deleting) return;
    const result = await callClientAction(
      () => deleteSiteAction(deleting.id),
      t("common.operationFailed"),
    );
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("sites.deleted"));
    setDeleting(null);
    router.refresh();
  }

  function embedSnippet(site: SiteRecord): string {
    return `<script src="${appUrl.replace(/\/$/, "")}/widget.js?key=${site.publicKey}" async></script>`;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          {t("common.total")} {sites.length} {t("common.items")}
        </p>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="size-4" />
          <span className="ml-1.5">{t("sites.new")}</span>
        </Button>
      </div>

      {sites.length === 0 ? (
        <EmptyState
          title={t("common.empty")}
          description={t("sites.subtitle")}
          action={
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
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
                      onCheckedChange={(checked) =>
                        void handleToggle(site, checked)
                      }
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
                        <DropdownMenuItem
                          onSelect={() => {
                            setEditing(site);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="size-4" />
                          {t("common.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setEmbedSite(site)}>
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
                          onSelect={() => setDeleting(site)}
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

      <SiteFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        site={editing}
        defaultSettings={defaultSettings}
        canCustomizeFooter={canCustomizeFooter}
        onSaved={() => router.refresh()}
      />

      <Dialog
        open={Boolean(embedSite)}
        onOpenChange={(open) => !open && setEmbedSite(null)}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("sites.embedCode")}</DialogTitle>
            <DialogDescription>
              {t("sites.embedHint")} · {embedSite?.name}
            </DialogDescription>
          </DialogHeader>

          {embedSite ? (
            <div className="min-w-0 space-y-3">
              <pre className="bg-muted max-h-40 overflow-auto rounded-md border p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
                {embedSnippet(embedSite)}
              </pre>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-muted-foreground flex min-w-0 flex-1 items-center gap-1.5 text-xs">
                  <Globe className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {embedSite.allowedOrigins.length === 0
                      ? t("sites.allowedOriginsFree")
                      : embedSite.allowedOrigins.join("、")}
                  </span>
                </div>
                <CopyButton
                  value={embedSnippet(embedSite)}
                  label={t("common.copy")}
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                />
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("sites.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>
              {t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
