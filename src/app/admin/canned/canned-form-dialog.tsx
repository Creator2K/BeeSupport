"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { callClientAction } from "@/lib/client-action";
import {
  createCannedAction,
  updateCannedAction,
} from "@/server/actions/canned";

import type { CannedRecord, CannedSiteOption } from "./canned-types";

export function CannedFormDialog({
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
  sites: CannedSiteOption[];
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
