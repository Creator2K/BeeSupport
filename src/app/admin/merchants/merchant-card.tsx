"use client";

import { Button } from "@/components/ui/button";

import { merchantStatusLabels, type Merchant } from "./merchant-types";

export function MerchantCard({
  tenant,
  onEdit,
}: {
  tenant: Merchant;
  onEdit: () => void;
}) {
  return (
    <article className="min-w-0 space-y-4 rounded-xl border p-4">
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
            : merchantStatusLabels[tenant.status]}
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
        <Button size="sm" variant="outline" onClick={onEdit}>
          审核 / 套餐 / 续期
        </Button>
      </div>
    </article>
  );
}
