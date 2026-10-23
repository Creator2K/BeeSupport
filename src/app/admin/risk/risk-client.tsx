"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { callClientAction } from "@/lib/client-action";
import {
  deleteRiskRuleAction,
  saveRiskRuleAction,
  setRiskRuleActiveAction,
} from "@/server/actions/risk";

type Rule = {
  id: string;
  kind: string;
  value: string;
  siteId: string | null;
  siteName: string;
  note: string | null;
  active: boolean;
  expiresAt: string | null;
  expiryLabel: string;
  expired: boolean;
  updatedAt: string;
};
type Event = {
  id: string;
  kind: string;
  ruleValue: string;
  ip: string;
  siteName: string;
  visitorId: string | null;
  context: string;
  createdAt: string;
  createdLabel: string;
};
const selectStyle =
  "border-input bg-background h-9 rounded-md border px-3 text-sm";
const dateValue = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};

export function RiskClient({
  basePath,
  rules,
  events,
  sites,
  total,
  eventTotal,
  page,
  eventPage,
  filters,
  initialIp,
  initialSiteId,
  activeCount,
  recentCount,
}: {
  basePath: string;
  rules: Rule[];
  events: Event[];
  sites: { id: string; name: string }[];
  total: number;
  eventTotal: number;
  page: number;
  eventPage: number;
  filters: { kind: string; siteId: string; query: string };
  initialIp: string;
  initialSiteId: string;
  activeCount: number;
  recentCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(initialIp));
  const [editing, setEditing] = useState<Rule | null>(null);
  const [kind, setKind] = useState(initialIp ? "IP" : "WORD");
  const [values, setValues] = useState(initialIp);
  const [siteId, setSiteId] = useState(initialSiteId);
  const [note, setNote] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<Rule | null>(null);
  const [confirmedRules, setConfirmedRules] = useState<
    Record<string, { active: boolean; updatedAt: string }>
  >({});
  const [deletedRules, setDeletedRules] = useState<string[]>([]);
  const visibleRules = rules
    .filter((rule) => !deletedRules.includes(rule.id))
    .map((rule) => {
      const confirmed = confirmedRules[rule.id];
      return confirmed && confirmed.updatedAt > rule.updatedAt
        ? { ...rule, active: confirmed.active }
        : rule;
    });
  const displayedTotal =
    total - rules.filter((rule) => deletedRules.includes(rule.id)).length;
  const displayedActive =
    activeCount +
    rules.reduce((change, rule) => {
      if (rule.expired) return change;
      const visible = visibleRules.find((item) => item.id === rule.id);
      return change + Number(Boolean(visible?.active)) - Number(rule.active);
    }, 0);
  function edit(rule: Rule | null) {
    setEditing(rule);
    setKind(rule?.kind ?? "WORD");
    setValues(rule?.value ?? "");
    setSiteId(rule?.siteId ?? "");
    setNote(rule?.note ?? "");
    setExpiresAt(dateValue(rule?.expiresAt ?? null));
    setError("");
    setOpen(true);
  }
  async function run(action: () => ReturnType<typeof deleteRiskRuleAction>) {
    if (pending) return;
    setPending(true);
    try {
      const result = await callClientAction(action, "操作失败，请重试");
      if (!result.ok) {
        toast.error(result.error);
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setPending(false);
    }
  }
  function pageUrl(key: "page" | "eventPage", next: number) {
    const p = new URLSearchParams({
      ...filters,
      page: String(page),
      eventPage: String(eventPage),
    });
    p.set(key, String(next));
    return `${basePath}?${p}`;
  }
  return (
    <div className="min-w-0 space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["生效规则", displayedActive],
          ["近 24 小时拦截", recentCount],
          ["拦截记录", eventTotal],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <section className="min-w-0 rounded-xl border bg-card p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-medium">
            <ShieldCheck className="size-4" /> 拦截规则
          </h2>
          <Button size="sm" onClick={() => edit(null)}>
            <Plus className="size-4" />
            添加规则
          </Button>
        </div>
        <form className="mb-4 flex flex-wrap gap-2">
          <Input
            name="query"
            defaultValue={filters.query}
            placeholder="搜索规则内容"
            aria-label="搜索规则内容"
            className="w-full sm:w-48"
          />
          <select
            name="kind"
            defaultValue={filters.kind}
            aria-label="规则类型"
            className={selectStyle}
          >
            <option value="">全部类型</option>
            <option value="WORD">违禁词</option>
            <option value="IP">IP 封禁</option>
          </select>
          <select
            name="siteId"
            defaultValue={filters.siteId}
            aria-label="筛选站点"
            className={`${selectStyle} max-w-full`}
          >
            <option value="">全部站点</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
          <Button variant="outline" type="submit">
            筛选
          </Button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                {["类型 / 内容", "作用范围", "状态 / 到期", "备注", "操作"].map(
                  (s) => (
                    <th key={s} className="px-2 py-3 font-medium">
                      {s}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {visibleRules.map((rule) => {
                const expired = rule.expired;
                return (
                  <tr key={rule.id} className="border-b last:border-0">
                    <td className="max-w-56 break-all px-2 py-3">
                      <span className="mb-1 block text-[11px] text-muted-foreground">
                        {rule.kind === "IP" ? "IP 封禁" : "违禁词"}
                      </span>
                      {rule.value}
                    </td>
                    <td className="max-w-40 break-words px-2 py-3">
                      {rule.siteName}
                    </td>
                    <td className="px-2 py-3">
                      <span
                        className={
                          rule.active && !expired
                            ? "text-emerald-600"
                            : "text-muted-foreground"
                        }
                      >
                        {expired ? "已到期" : rule.active ? "生效中" : "已停用"}
                      </span>
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        {rule.expiresAt ? rule.expiryLabel : "永久"}
                      </span>
                    </td>
                    <td className="max-w-40 break-words px-2 py-3 text-xs text-muted-foreground">
                      {rule.note || "—"}
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => edit(rule)}
                        >
                          编辑
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() =>
                            void run(async () => {
                              const result = await setRiskRuleActiveAction(
                                rule.id,
                                !rule.active,
                              );
                              if (result.ok && "rule" in result)
                                setConfirmedRules((previous) => ({
                                  ...previous,
                                  [rule.id]: result.rule,
                                }));
                              return result;
                            })
                          }
                        >
                          {rule.active ? "停用" : "启用"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => setDeleting(rule)}
                        >
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!visibleRules.length && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              暂无规则，添加后将按选定范围拦截访客请求。
            </p>
          )}
        </div>
        <Pagination
          page={page}
          total={displayedTotal}
          previous={pageUrl("page", page - 1)}
          next={pageUrl("page", page + 1)}
        />
      </section>
      <section className="min-w-0 rounded-xl border bg-card p-4 sm:p-5">
        <h2 className="mb-2 font-medium">拦截记录</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          记录命中的规则和访问 IP，不保存被拦截的完整消息内容。
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="border-b text-muted-foreground">
              <tr>
                {["时间", "类型 / 命中内容", "站点", "IP", "访客"].map((s) => (
                  <th key={s} className="px-2 py-3 font-medium">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b last:border-0">
                  <td className="px-2 py-3">{event.createdLabel}</td>
                  <td className="max-w-48 break-all px-2 py-3">
                    {event.kind === "IP" ? "IP 封禁" : "违禁词"}
                    <span className="mt-1 block text-muted-foreground">
                      {event.ruleValue}
                    </span>
                  </td>
                  <td className="px-2 py-3">{event.siteName}</td>
                  <td className="px-2 py-3 font-mono">{event.ip}</td>
                  <td className="px-2 py-3">
                    {event.visitorId ? (
                      <Link
                        className="underline underline-offset-4"
                        href={`${basePath.replace(/\/risk$/, "/visitors")}/${event.visitorId}`}
                      >
                        查看画像
                      </Link>
                    ) : (
                      "未建立身份"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!events.length && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              暂无拦截记录
            </p>
          )}
        </div>
        <Pagination
          page={eventPage}
          total={eventTotal}
          previous={pageUrl("eventPage", eventPage - 1)}
          next={pageUrl("eventPage", eventPage + 1)}
        />
      </section>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!pending) setOpen(v);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑规则" : "添加规则"}</DialogTitle>
            <DialogDescription>
              违禁词拦截访客发送的文字；IP 支持单个地址或 CIDR
              网段，不限制客服登录。
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (pending) return;
              setPending(true);
              setError("");
              try {
                const result = await callClientAction(
                  () =>
                    saveRiskRuleAction(
                      {
                        kind: kind as "IP" | "WORD",
                        values,
                        siteId: siteId || null,
                        note,
                        expiresAt: expiresAt
                          ? new Date(expiresAt).toISOString()
                          : null,
                      },
                      editing?.id,
                    ),
                  "保存失败，请重试",
                );
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                toast.success(result.message || "规则已保存");
                setOpen(false);
                router.refresh();
              } finally {
                setPending(false);
              }
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="risk-kind">规则类型</Label>
                <select
                  id="risk-kind"
                  className={`${selectStyle} w-full`}
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  <option value="WORD">违禁词</option>
                  <option value="IP">IP 封禁</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="risk-site">作用范围</Label>
                <select
                  id="risk-site"
                  className={`${selectStyle} w-full`}
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                >
                  <option value="">全部站点</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="risk-values">
                {kind === "IP" ? "IP 地址 / 网段" : "违禁词"}
              </Label>
              <Textarea
                id="risk-values"
                required
                value={values}
                onChange={(e) => setValues(e.target.value)}
                rows={4}
                maxLength={20000}
                placeholder={
                  kind === "IP"
                    ? "203.0.113.10\n198.51.100.0/24\n2001:db8::/32"
                    : "每行一条词语"
                }
              />
              <p className="text-xs text-muted-foreground">
                {editing
                  ? "每次编辑一条规则。"
                  : "每行一条，最多批量添加 200 条。"}
                {kind === "WORD" && "忽略大小写、全半角和空白字符。"}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="risk-expires">到期时间（留空为永久）</Label>
              <Input
                id="risk-expires"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="risk-note">备注</Label>
              <Input
                id="risk-note"
                value={note}
                maxLength={300}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            {error && (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                type="button"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "保存中…" : "保存规则"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(value) => {
          if (!value && !pending) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这条规则？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后将停止拦截，已有拦截记录会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                if (deleting)
                  void run(() => deleteRiskRuleAction(deleting.id)).then(
                    (ok) => {
                      if (ok) {
                        setDeletedRules((previous) => [
                          ...previous,
                          deleting!.id,
                        ]);
                        setDeleting(null);
                      }
                    },
                  );
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Pagination({
  page,
  total,
  previous,
  next,
}: {
  page: number;
  total: number;
  previous: string;
  next: string;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>
        共 {total} 条 · 第 {page} / {Math.max(1, Math.ceil(total / 20))} 页
      </span>
      <div className="flex gap-2">
        <Button asChild variant="outline" size="sm" disabled={page <= 1}>
          <Link
            href={page <= 1 ? "#" : previous}
            aria-disabled={page <= 1}
            tabIndex={page <= 1 ? -1 : undefined}
            className={page <= 1 ? "pointer-events-none opacity-50" : ""}
          >
            上一页
          </Link>
        </Button>
        <Button
          asChild
          variant="outline"
          size="sm"
          disabled={page * 20 >= total}
        >
          <Link
            href={page * 20 >= total ? "#" : next}
            aria-disabled={page * 20 >= total}
            tabIndex={page * 20 >= total ? -1 : undefined}
            className={
              page * 20 >= total ? "pointer-events-none opacity-50" : ""
            }
          >
            下一页
          </Link>
        </Button>
      </div>
    </div>
  );
}
