"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  type PlanInput,
  type PlanView,
  centsFromYuan,
  formatPrice,
} from "@/lib/subscriptions";
import { savePlanAction } from "@/server/actions/subscriptions";
import { callClientAction } from "@/lib/client-action";
import { BASIC_FEATURES, readFeatures } from "@/lib/entitlements";
import { FeatureControls } from "@/components/admin/feature-controls";
import { FeatureSummary } from "@/components/admin/feature-summary";

const defaults: PlanInput = {
  name: "",
  description: "",
  priceCents: 0,
  durationDays: 30,
  maxAgents: 5,
  maxSites: 3,
  monthlyConversations: 3000,
  storageMB: 1024,
  active: false,
  sortOrder: 0,
  features: BASIC_FEATURES,
};
export function PlansClient({ plans }: { plans: PlanView[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<PlanView | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PlanInput>(defaults);
  const [price, setPrice] = useState("0.00");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  function edit(plan?: PlanView) {
    setEditing(plan ?? null);
    setForm(
      plan
        ? {
            name: plan.name,
            features: plan.features,
            description: plan.description,
            priceCents: plan.priceCents,
            durationDays: plan.durationDays,
            maxAgents: plan.maxAgents,
            maxSites: plan.maxSites,
            monthlyConversations: plan.monthlyConversations,
            storageMB: plan.storageMB,
            active: plan.active,
            sortOrder: plan.sortOrder,
          }
        : { ...defaults },
    );
    setPrice(((plan?.priceCents ?? 0) / 100).toFixed(2));
    setError("");
    setOpen(true);
  }
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => edit()}>新增套餐</Button>
      </div>
      {!plans.length && (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          还没有套餐。请先设置价格与额度，再上架供商家选择。
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan) => (
          <article
            key={plan.id}
            className="min-w-0 space-y-3 rounded-xl border p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="truncate font-medium">{plan.name}</h2>
              <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs">
                {plan.active ? "已上架" : "已下架"}
              </span>
            </div>
            <p className="text-2xl font-semibold">
              {formatPrice(plan.priceCents)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                / {plan.durationDays} 天
              </span>
            </p>
            <p className="break-words text-sm text-muted-foreground">
              {plan.description}
            </p>
            <p className="text-xs leading-6">
              {plan.maxAgents} 个启用账号 · {plan.maxSites} 个站点
              <br />
              每月 {plan.monthlyConversations} 个新会话 · {plan.storageMB} MB
              存储
            </p>
            <FeatureSummary features={plan.features} />
            <Button size="sm" variant="outline" onClick={() => edit(plan)}>
              编辑套餐
            </Button>
          </article>
        ))}
      </div>
      <Dialog open={open} onOpenChange={(value) => !pending && setOpen(value)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑套餐" : "新增套餐"}</DialogTitle>
            <DialogDescription>
              价格和额度的修改只影响后续订单，商家的现有套餐保持原值。
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const cents = centsFromYuan(price);
              if (cents === null) {
                setError("价格最多保留两位小数，范围 0–1000000 元");
                return;
              }
              setPending(true);
              setError("");
              const result = await callClientAction(
                () =>
                  savePlanAction(
                    { ...form, priceCents: cents },
                    editing?.id,
                    editing?.updatedAt,
                  ),
                "套餐保存失败，请重试",
              );
              setPending(false);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              toast.success(result.message);
              setOpen(false);
              router.refresh();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="plan-name">套餐名称</Label>
              <Input
                id="plan-name"
                required
                maxLength={60}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan-description">套餐说明</Label>
              <Textarea
                id="plan-description"
                maxLength={500}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="plan-price">价格（元）</Label>
                <Input
                  id="plan-price"
                  required
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
              {(
                [
                  ["durationDays", "有效天数"],
                  ["maxAgents", "启用账号上限"],
                  ["maxSites", "站点上限"],
                  ["monthlyConversations", "每月新会话上限"],
                  ["storageMB", "存储空间 MB"],
                  ["sortOrder", "排序（越小越靠前）"],
                ] as const
              ).map(([key, label]) => (
                <div className="space-y-2" key={key}>
                  <Label htmlFor={`plan-${key}`}>{label}</Label>
                  <Input
                    id={`plan-${key}`}
                    type="number"
                    min={key === "sortOrder" ? 0 : 1}
                    step={1}
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
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              上架，允许商家提交订单
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "保存中…" : "保存套餐"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
