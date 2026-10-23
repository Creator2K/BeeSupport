"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  saveTenantAction,
  type TenantInput,
  type TenantOwnerInput,
} from "@/server/actions/tenants";
import { callClientAction } from "@/lib/client-action";
import { BASIC_FEATURES, readFeatures } from "@/lib/entitlements";
import { FeatureControls } from "@/components/admin/feature-controls";

type Merchant = Omit<TenantInput, "expiresAt" | "contactEmail" | "note"> & {
  id: string;
  managementVersion: number;
  expiresAt: string | null;
  contactEmail: string | null;
  note: string | null;
  usage: {
    agents: number;
    sites: number;
    conversations: number;
    storageBytes: number;
  };
};
const empty: TenantInput = {
  name: "",
  slug: "",
  status: "ACTIVE",
  planName: "基础版",
  expiresAt: null,
  maxAgents: 5,
  maxSites: 3,
  monthlyConversations: 3000,
  storageMB: 1024,
  contactEmail: "",
  note: "",
  features: BASIC_FEATURES,
};
const statusLabels = {
  PENDING: "待审核",
  ACTIVE: "已开通",
  SUSPENDED: "已停用",
};
export function MerchantsClient({
  tenants,
  search = "",
  status = "",
}: {
  tenants: Merchant[];
  search?: string;
  status?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | undefined>();
  const [version, setVersion] = useState<number | undefined>();
  const [form, setForm] = useState<TenantInput>(empty);
  const [owner, setOwner] = useState<TenantOwnerInput>({
    ownerName: "",
    ownerEmail: "",
    ownerPassword: "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  function edit(tenant?: Merchant) {
    setEditing(tenant?.id);
    setVersion(tenant?.managementVersion);
    setError("");
    setForm(
      tenant
        ? {
            name: tenant.name,
            features: readFeatures(tenant.features),
            slug: tenant.slug,
            status: tenant.status,
            planName: tenant.planName,
            expiresAt: tenant.expiresAt,
            maxAgents: tenant.maxAgents,
            maxSites: tenant.maxSites,
            monthlyConversations: tenant.monthlyConversations,
            storageMB: tenant.storageMB,
            contactEmail: tenant.contactEmail ?? "",
            note: tenant.note ?? "",
          }
        : { ...empty },
    );
    setOwner({ ownerName: "", ownerEmail: "", ownerPassword: "" });
    setOpen(true);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const result = await callClientAction(
      () =>
        saveTenantAction(form, editing, editing ? undefined : owner, version),
      "保存失败，请重试",
    );
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(result.message);
    setOpen(false);
    router.refresh();
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form
          className="flex max-w-full flex-wrap gap-2"
          key={`${search}:${status}`}
        >
          <Input
            className="max-w-xs"
            aria-label="搜索商家"
            name="search"
            placeholder="名称、标识或联系邮箱"
            defaultValue={search}
          />
          <select
            name="status"
            aria-label="商家状态"
            defaultValue={status}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">全部状态</option>
            <option value="PENDING">待审核</option>
            <option value="ACTIVE">已开通</option>
            <option value="SUSPENDED">已停用</option>
            <option value="EXPIRED">已到期</option>
          </select>
          <Button type="submit" variant="outline">
            搜索商家
          </Button>
        </form>
        <Button onClick={() => edit()}>新增商家</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        启用账号数包含商家管理员；站点数量包含停用站点。存储包含尚未绑定消息的附件。
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {tenants.map((tenant) => (
          <article
            className="min-w-0 space-y-4 rounded-xl border p-4"
            key={tenant.id}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate font-semibold">{tenant.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {tenant.slug} · {tenant.planName}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs">
                {tenant.expiresAt && new Date(tenant.expiresAt) <= new Date()
                  ? "已到期"
                  : statusLabels[tenant.status]}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {[
                ["启用账号", `${tenant.usage.agents} / ${tenant.maxAgents}`],
                ["站点", `${tenant.usage.sites} / ${tenant.maxSites}`],
                [
                  "本月会话",
                  `${tenant.usage.conversations} / ${tenant.monthlyConversations}`,
                ],
                [
                  "存储 MB",
                  `${(tenant.usage.storageBytes / 1048576).toFixed(1)} / ${tenant.storageMB}`,
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                {tenant.expiresAt
                  ? `到期：${new Date(tenant.expiresAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`
                  : "长期有效"}
              </p>
              <Button size="sm" variant="outline" onClick={() => edit(tenant)}>
                审核 / 套餐 / 续期
              </Button>
            </div>
          </article>
        ))}
      </div>
      <Dialog open={open} onOpenChange={(value) => !pending && setOpen(value)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? "商家与套餐设置" : "新增商家"}</DialogTitle>
            <DialogDescription>
              开通后商家使用下方管理员账号登录。到期不删除历史记录。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ["name", "商家名称"],
                  ["slug", "唯一标识"],
                  ["planName", "套餐名称"],
                  ["contactEmail", "联系邮箱"],
                ] as const
              ).map(([key, label]) => (
                <div className="space-y-1.5" key={key}>
                  <Label htmlFor={`merchant-${key}`}>{label}</Label>
                  <Input
                    id={`merchant-${key}`}
                    type={key === "contactEmail" ? "email" : "text"}
                    required={key !== "contactEmail"}
                    value={form[key]}
                    onChange={(e) =>
                      setForm({ ...form, [key]: e.target.value })
                    }
                  />
                </div>
              ))}
              <div className="space-y-1.5">
                <Label htmlFor="merchant-status">服务状态</Label>
                <select
                  id="merchant-status"
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={form.status}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      status: e.target.value as TenantInput["status"],
                    })
                  }
                >
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="merchant-expiry">
                  到期时间（北京时间，可留空）
                </Label>
                <Input
                  id="merchant-expiry"
                  type="datetime-local"
                  value={
                    form.expiresAt
                      ? new Date(
                          new Date(form.expiresAt).getTime() + 8 * 3600000,
                        )
                          .toISOString()
                          .slice(0, 16)
                      : ""
                  }
                  onChange={(e) =>
                    setForm({
                      ...form,
                      expiresAt: e.target.value
                        ? new Date(`${e.target.value}+08:00`).toISOString()
                        : null,
                    })
                  }
                />
              </div>
              {(
                [
                  ["maxAgents", "启用账号上限"],
                  ["maxSites", "站点上限"],
                  ["monthlyConversations", "每月新会话上限"],
                  ["storageMB", "存储空间 MB"],
                ] as const
              ).map(([key, label]) => (
                <div className="space-y-1.5" key={key}>
                  <Label htmlFor={`merchant-${key}`}>{label}</Label>
                  <Input
                    id={`merchant-${key}`}
                    type="number"
                    min={1}
                    required
                    value={form[key]}
                    onChange={(e) =>
                      setForm({ ...form, [key]: Number(e.target.value) })
                    }
                  />
                </div>
              ))}
            </div>
            <FeatureControls
              value={readFeatures(form.features)}
              onChange={(features) => setForm({ ...form, features })}
            />
            {!editing && (
              <fieldset className="space-y-3 rounded-lg border p-3">
                <legend className="px-1 text-sm">商家管理员账号</legend>
                {(
                  [
                    ["ownerName", "姓名", "text"],
                    ["ownerEmail", "登录邮箱", "email"],
                    ["ownerPassword", "初始密码（至少 8 位）", "password"],
                  ] as const
                ).map(([key, label, type]) => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={key}>{label}</Label>
                    <Input
                      id={key}
                      type={type}
                      required
                      autoComplete={
                        key === "ownerPassword" ? "new-password" : "off"
                      }
                      value={owner[key]}
                      onChange={(e) =>
                        setOwner({ ...owner, [key]: e.target.value })
                      }
                    />
                  </div>
                ))}
              </fieldset>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="merchant-note">平台内部备注</Label>
              <Input
                id="merchant-note"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button disabled={pending} type="submit" className="w-full">
              {pending ? "保存中…" : "保存商家及套餐"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
