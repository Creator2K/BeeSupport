"use client";

import { callClientAction } from "@/lib/client-action";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
  DialogFooter,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  createCannedAction,
  deleteCannedAction,
  updateCannedAction,
} from "@/server/actions/canned";

export type CannedRecord = {
  id: string;
  title: string;
  category: string;
  tenantName: string | null;
  shortcut: string | null;
  content: string;
  siteId: string | null;
  siteName: string | null;
  shared: boolean;
  usageCount: number;
  ownerName: string | null;
};

export type SiteOption = { id: string; name: string };

export function CannedClient({
  items,
  sites,
  categories,
  total,
}: {
  categories: string[];
  total: number;
  items: CannedRecord[];
  sites: SiteOption[];
}) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState<CannedRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<CannedRecord | null>(null);

  async function handleDelete() {
    if (!deleting) return;
    const result = await callClientAction(
      () => deleteCannedAction(deleting.id),
      t("common.operationFailed"),
    );
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("canned.deleted"));
    setDeleting(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          {t("common.total")} {total} {t("common.items")}
        </p>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
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
                        <DropdownMenuItem
                          onSelect={() => {
                            setEditing(item);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="size-4" />
                          {t("common.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setDeleting(item)}
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

      <CannedFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        item={editing}
        sites={sites}
        categories={categories}
        onSaved={() => router.refresh()}
      />

      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("common.deleteConfirm")}
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

function CannedFormDialog({
  open,
  onOpenChange,
  item,
  sites,
  categories,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: CannedRecord | null;
  sites: SiteOption[];
  categories: string[];
  onSaved: () => void;
}) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [shortcut, setShortcut] = useState("");
  const [category, setCategory] = useState("");
  const [content, setContent] = useState("");
  const [siteId, setSiteId] = useState<string>("__global__");
  const [shared, setShared] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTitle(item?.title ?? "");
    setShortcut(item?.shortcut ?? "");
    setCategory(item?.category ?? "");
    setContent(item?.content ?? "");
    setSiteId(item?.siteId ?? "__global__");
    setShared(item?.shared ?? true);
  }, [open, item]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const payload = {
      title,
      shortcut,
      category,
      content,
      siteId: siteId === "__global__" ? null : siteId,
      shared,
    };

    const result = item
      ? await callClientAction(
          () => updateCannedAction(item.id, payload),
          t("common.operationFailed"),
        )
      : await callClientAction(
          () => createCannedAction(payload),
          t("common.operationFailed"),
        );

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    toast.success(item ? t("canned.updated") : t("canned.created"));
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {item ? t("canned.editTitle") : t("canned.new")}
          </DialogTitle>
          <DialogDescription>{t("canned.subtitle")}</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="canned-title">{t("canned.titleLabel")}</Label>
            <Input
              id="canned-title"
              maxLength={80}
              value={title}
              required
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="canned-shortcut">{t("canned.shortcutLabel")}</Label>
            <Input
              id="canned-shortcut"
              maxLength={30}
              value={shortcut}
              placeholder="price"
              onChange={(event) => setShortcut(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              {t("canned.shortcutHint")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="canned-content">{t("canned.contentLabel")}</Label>
            <Textarea
              id="canned-content"
              maxLength={2000}
              rows={4}
              value={content}
              required
              onChange={(event) => setContent(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="canned-category">{t("canned.category")}</Label>
            <Input
              id="canned-category"
              maxLength={30}
              value={category}
              list="canned-form-categories"
              placeholder={t("canned.categoryHint")}
              onChange={(event) => setCategory(event.target.value)}
            />
            <datalist id="canned-form-categories">
              {categories.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="canned-site">{t("canned.scope")}</Label>
              <Select value={siteId} onValueChange={setSiteId}>
                <SelectTrigger id="canned-site">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__global__">
                    {t("canned.scopeGlobal")}
                  </SelectItem>
                  {sites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end justify-between gap-3 pb-1.5">
              <Label htmlFor="canned-shared" className="text-sm font-normal">
                {t("canned.shared")}
              </Label>
              <Switch
                id="canned-shared"
                checked={shared}
                onCheckedChange={setShared}
              />
            </div>
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("common.saving")}
                </>
              ) : (
                t("common.save")
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
