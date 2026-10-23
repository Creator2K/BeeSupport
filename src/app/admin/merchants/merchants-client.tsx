"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callClientAction } from "@/lib/client-action";
import { BASIC_FEATURES, readFeatures } from "@/lib/entitlements";
import {
  saveTenantAction,
  type TenantInput,
  type TenantOwnerInput,
} from "@/server/actions/tenants";

import { MerchantCard } from "./merchant-card";
import { MerchantDialog } from "./merchant-dialog";
import type { Merchant } from "./merchant-types";

export type { Merchant } from "./merchant-types";

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
          <MerchantCard
            key={tenant.id}
            tenant={tenant}
            onEdit={() => edit(tenant)}
          />
        ))}
      </div>
      <MerchantDialog
        open={open}
        editing={Boolean(editing)}
        form={form}
        owner={owner}
        pending={pending}
        error={error}
        onOpenChange={setOpen}
        onFormChange={setForm}
        onOwnerChange={setOwner}
        onSubmit={submit}
      />
    </div>
  );
}
