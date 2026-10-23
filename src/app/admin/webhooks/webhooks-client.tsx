"use client";

import { callClientAction } from "@/lib/client-action";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import type { MessageKey } from "@/lib/i18n/dictionaries";
import {
  createWebhookAction,
  deleteWebhookAction,
  testWebhookAction,
  toggleWebhookAction,
  updateWebhookAction,
} from "@/server/actions/webhooks";

export type WebhookRecord = {
  id: string;
  name: string;
  type:
    | "GENERIC"
    | "TELEGRAM"
    | "DINGTALK"
    | "WECHAT_WORK"
    | "WECHAT"
    | "WECHAT_BOT";
  url: string;
  secret: string | null;
  events: string[];
  siteId: string | null;
  siteName: string | null;
  active: boolean;
  lastStatus: string | null;
  lastTriggeredAt: string | null;
};

export type SiteOption = { id: string; name: string };

const EVENT_OPTIONS: { value: string; labelKey: MessageKey }[] = [
  {
    value: "conversation.created",
    labelKey: "webhooks.eventConversationCreated",
  },
  {
    value: "conversation.offline",
    labelKey: "webhooks.eventConversationOffline",
  },
  {
    value: "conversation.assigned",
    labelKey: "webhooks.eventConversationAssigned",
  },
  {
    value: "conversation.closed",
    labelKey: "webhooks.eventConversationClosed",
  },
  { value: "message.created", labelKey: "webhooks.eventMessageCreated" },
];

const TYPE_LABELS: Record<WebhookRecord["type"], MessageKey> = {
  GENERIC: "webhooks.typeGeneric",
  TELEGRAM: "webhooks.typeTelegram",
  DINGTALK: "webhooks.typeDingtalk",
  WECHAT_WORK: "webhooks.typeWechatWork",
  WECHAT_BOT: "webhooks.typeWechatBot",
  WECHAT: "webhooks.typeWechatBridge",
};

/** 新建渠道时只给一个微信选项：后台扫码登录的那个 */
const TYPE_ORDER: WebhookRecord["type"][] = [
  "GENERIC",
  "TELEGRAM",
  "DINGTALK",
  "WECHAT_WORK",
  "WECHAT_BOT",
];

/** 历史数据里可能存在的外部桥接渠道，只有编辑它时才出现在下拉里 */
const LEGACY_TYPES: WebhookRecord["type"][] = ["WECHAT"];

const URL_HINTS: Record<WebhookRecord["type"], MessageKey> = {
  GENERIC: "webhooks.urlHintGeneric",
  TELEGRAM: "webhooks.urlHintTelegram",
  DINGTALK: "webhooks.urlHintDingtalk",
  WECHAT_WORK: "webhooks.urlHintWechat",
  WECHAT_BOT: "webhooks.urlHintWechatInternal",
  WECHAT: "webhooks.urlHintWechatBot",
};

export function WebhooksClient({
  endpoints,
  sites,
  platform = false,
}: {
  platform?: boolean;
  endpoints: WebhookRecord[];
  sites: SiteOption[];
}) {
  const t = useT();
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WebhookRecord | null>(null);
  const [deleting, setDeleting] = useState<WebhookRecord | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  async function handleToggle(endpoint: WebhookRecord, active: boolean) {
    const result = await callClientAction(
      () => toggleWebhookAction(endpoint.id, active),
      t("common.operationFailed"),
    );
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  async function handleTest(endpoint: WebhookRecord) {
    setTestingId(endpoint.id);
    const result = await callClientAction(
      () =>
        testWebhookAction({
          type: endpoint.type,
          url: endpoint.url,
          secret: endpoint.secret,
          siteId: endpoint.siteId,
        }),
      t("common.operationFailed"),
    );
    setTestingId(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("webhooks.testSuccess"));
    router.refresh();
  }

  async function handleDelete() {
    if (!deleting) return;
    const result = await callClientAction(
      () => deleteWebhookAction(deleting.id),
      t("common.operationFailed"),
    );
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("webhooks.deleted"));
    setDeleting(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          {t("common.total")} {endpoints.length} {t("common.items")}
        </p>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
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
                            .join("、")}
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
                      onCheckedChange={(checked) =>
                        void handleToggle(endpoint, checked)
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
                            setEditing(endpoint);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="size-4" />
                          {t("common.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={testingId === endpoint.id}
                          onSelect={() => void handleTest(endpoint)}
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
                          onSelect={() => setDeleting(endpoint)}
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

      <WebhookFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        endpoint={editing}
        sites={sites}
        platform={platform}
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

function WebhookFormDialog({
  open,
  onOpenChange,
  endpoint,
  sites,
  onSaved,
  platform,
}: {
  platform: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  endpoint: WebhookRecord | null;
  sites: SiteOption[];
  onSaved: () => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [type, setType] = useState<WebhookRecord["type"]>("GENERIC");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [siteId, setSiteId] = useState("__all__");
  const [active, setActive] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(endpoint?.name ?? "");
    setType(endpoint?.type ?? "GENERIC");
    setUrl(endpoint?.url ?? "");
    setSecret(endpoint?.secret ?? "");
    setEvents(endpoint?.events ?? []);
    setSiteId(endpoint?.siteId ?? "__all__");
    setActive(endpoint?.active ?? true);
  }, [open, endpoint]);

  function toggleEvent(value: string) {
    setEvents((prev) =>
      prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value],
    );
  }

  const isWechatBot = type === "WECHAT_BOT";
  const typeOptions = [
    ...TYPE_ORDER,
    ...(LEGACY_TYPES.includes(type) ? LEGACY_TYPES : []),
  ].filter(
    (option) => platform || (option !== "WECHAT_BOT" && option !== "WECHAT"),
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const payload = {
      name,
      type,
      url,
      secret: secret || null,
      events,
      siteId: siteId === "__all__" ? null : siteId,
      active,
    };

    const result = endpoint
      ? await callClientAction(
          () => updateWebhookAction(endpoint.id, payload),
          t("common.operationFailed"),
        )
      : await callClientAction(
          () => createWebhookAction(payload),
          t("common.operationFailed"),
        );

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    toast.success(endpoint ? t("webhooks.updated") : t("webhooks.created"));
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {endpoint ? t("webhooks.editTitle") : t("webhooks.new")}
          </DialogTitle>
          <DialogDescription>{t("webhooks.subtitle")}</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="webhook-name">{t("common.name")}</Label>
            <Input
              id="webhook-name"
              value={name}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("webhooks.typeLabel")}</Label>
            <Select
              value={type}
              onValueChange={(value) => setType(value as WebhookRecord["type"])}
            >
              <SelectTrigger aria-label={t("webhooks.typeLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {typeOptions.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(TYPE_LABELS[value])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="webhook-url">
              {isWechatBot
                ? t("webhooks.wechatTargetLabel")
                : t("webhooks.urlLabel")}
            </Label>
            <Input
              id="webhook-url"
              value={url}
              required={!isWechatBot}
              placeholder={t(URL_HINTS[type])}
              onChange={(event) => setUrl(event.target.value)}
            />
            <p className="text-muted-foreground font-mono text-[11px] break-all">
              {t(URL_HINTS[type])}
            </p>
            {isWechatBot ? (
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t("webhooks.wechatInternalHint")}{" "}
                <a
                  href="#wechat-login"
                  className="underline underline-offset-2"
                  onClick={(event) => {
                    event.preventDefault();
                    document
                      .getElementById("wechat-login")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  {t("webhooks.wechatGoLogin")}
                </a>
              </p>
            ) : null}
            {type === "WECHAT" ? (
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t("webhooks.wechatBridgeHint")}
              </p>
            ) : null}
          </div>

          {type === "GENERIC" ? (
            <div className="space-y-2">
              <Label htmlFor="webhook-secret">
                {t("webhooks.secretLabel")}
              </Label>
              <Input
                id="webhook-secret"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t("webhooks.secretHint")}
              </p>
            </div>
          ) : null}

          {type === "WECHAT" ? (
            <div className="space-y-2">
              <Label htmlFor="webhook-secret">
                {t("webhooks.secretLabel")}
              </Label>
              <Input
                id="webhook-secret"
                value={secret}
                placeholder={t("webhooks.secretHint")}
                onChange={(event) => setSecret(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t("webhooks.secretHint")}
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>{t("webhooks.eventsLabel")}</Label>
            <div className="space-y-2 rounded-md border p-3">
              {EVENT_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={events.includes(option.value)}
                    onCheckedChange={() => toggleEvent(option.value)}
                  />
                  {t(option.labelKey)}
                </label>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              {t("webhooks.eventsHint")}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("webhooks.siteScope")}</Label>
              <Select value={siteId} onValueChange={setSiteId}>
                <SelectTrigger aria-label={t("webhooks.siteScope")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">
                    {t("webhooks.siteScopeAll")}
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
              <Label className="text-sm font-normal">
                {t("common.enabled")}
              </Label>
              <Switch
                checked={active}
                onCheckedChange={setActive}
                aria-label={t("common.enabled")}
              />
            </div>
          </div>

          {error ? (
            <p className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-xs">
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
