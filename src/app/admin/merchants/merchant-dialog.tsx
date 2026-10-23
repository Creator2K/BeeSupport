"use client";

import { FeatureControls } from "@/components/admin/feature-controls";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readFeatures } from "@/lib/entitlements";
import type {
  TenantInput,
  TenantOwnerInput,
} from "@/server/actions/tenants";

import { merchantStatusLabels } from "./merchant-types";

export function MerchantDialog({
  open,
  editing,
  form,
  owner,
  pending,
  error,
  onOpenChange,
  onFormChange,
  onOwnerChange,
  onSubmit,
}: {
  open: boolean;
  editing: boolean;
  form: TenantInput;
  owner: TenantOwnerInput;
  pending: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onFormChange: (form: TenantInput) => void;
  onOwnerChange: (owner: TenantOwnerInput) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(value) => !pending && onOpenChange(value)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "商家与套餐设置" : "新增商家"}</DialogTitle>
          <DialogDescription>
            开通后商家使用下方管理员账号登录。到期不删除历史记录。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
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
                  onChange={(event) =>
                    onFormChange({ ...form, [key]: event.target.value })
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
                onChange={(event) =>
                  onFormChange({
                    ...form,
                    status: event.target.value as TenantInput["status"],
                  })
                }
              >
                {Object.entries(merchantStatusLabels).map(([value, label]) => (
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
                onChange={(event) =>
                  onFormChange({
                    ...form,
                    expiresAt: event.target.value
                      ? new Date(`${event.target.value}+08:00`).toISOString()
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
                  onChange={(event) =>
                    onFormChange({ ...form, [key]: Number(event.target.value) })
                  }
                />
              </div>
            ))}
          </div>
          <FeatureControls
            value={readFeatures(form.features)}
            onChange={(features) => onFormChange({ ...form, features })}
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
                    onChange={(event) =>
                      onOwnerChange({ ...owner, [key]: event.target.value })
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
              onChange={(event) =>
                onFormChange({ ...form, note: event.target.value })
              }
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
  );
}
