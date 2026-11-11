"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { callClientAction } from "@/lib/client-action";
import type { AiPolicyAutoReply } from "@/lib/ai-policy";
import { saveMerchantAiPolicyAction } from "@/server/actions/ai-policy";
import type {
  AiPolicyEditorValue,
  MerchantAiSettings,
} from "@/server/services/ai-policy";

export function MerchantAiClient({ settings }: { settings: MerchantAiSettings }) {
  const router = useRouter();
  const [policies, setPolicies] = useState<AiPolicyEditorValue[]>([
    settings.tenantPolicy,
    ...settings.sitePolicies,
  ]);
  const [selected, setSelected] = useState(scopeKey(settings.tenantPolicy));
  const [saving, setSaving] = useState(false);
  const active = useMemo(
    () => policies.find((policy) => scopeKey(policy) === selected) ?? policies[0],
    [policies, selected],
  );
  const siteUsage = useMemo(
    () => new Map(settings.usage.sites.map((site) => [site.siteId, site])),
    [settings.usage.sites],
  );

  function update<K extends keyof AiPolicyEditorValue>(
    key: K,
    value: AiPolicyEditorValue[K],
  ) {
    setPolicies((current) =>
      current.map((policy) =>
        scopeKey(policy) === selected ? { ...policy, [key]: value } : policy,
      ),
    );
  }

  function selectScope(value: string) {
    setSelected(value);
  }

  async function save() {
    setSaving(true);
    const result = await callClientAction(
      () =>
        saveMerchantAiPolicyAction({
          scope: active.scope,
          siteId: active.siteId,
          version: active.version,
          enabledMode: active.enabledMode,
          autoReply: active.autoReply,
          assistantName: active.assistantName,
          systemPrompt: active.systemPrompt,
          toolsMode: active.toolsMode,
          mutationsMode: active.mutationsMode,
          monthlyRequestLimit: active.monthlyRequestLimit,
          monthlyTokenLimit: active.monthlyTokenLimit,
          concurrencyLimit: active.concurrencyLimit,
          overLimitAction: active.overLimitAction,
        }),
      "保存 AI 策略失败",
    );
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (result.version != null) {
      setPolicies((current) =>
        current.map((policy) =>
          scopeKey(policy) === selected
            ? { ...policy, version: result.version! }
            : policy,
        ),
      );
    }
    toast.success("AI 策略已保存");
    router.refresh();
  }

  const currentUsage =
    active.scope === "site" && active.siteId
      ? siteUsage.get(active.siteId)
      : undefined;

  return (
    <div className="max-w-5xl space-y-5">
      {!settings.featureEnabled ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-950 dark:text-amber-200">
          当前套餐未开通 AI 功能。策略可以预先配置，但不会产生 AI 回复或调用。
        </div>
      ) : null}
      {!settings.providerReady ? (
        <div className="bg-muted/60 text-foreground rounded-xl border p-4 text-sm">
          平台尚未启用 AI 接口。策略可以保存，接口就绪后才会生效。
        </div>
      ) : null}

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">商家 AI 策略</CardTitle>
          <CardDescription>
            商家默认策略对所有站点生效；站点策略可覆盖提示词、自动回复、工具权限和额度。
            平台接口密钥与模型仍由平台统一管理。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>生效范围</Label>
            <Select value={selected} onValueChange={selectScope}>
              <SelectTrigger className="max-w-md" aria-label="生效范围">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={scopeKey(settings.tenantPolicy)}>
                  商家默认 · {settings.tenantName}
                </SelectItem>
                {settings.sitePolicies.map((policy) => (
                  <SelectItem key={policy.siteId} value={scopeKey(policy)}>
                    站点 · {policy.siteName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>启用状态</Label>
              <Select
                value={active.enabledMode}
                onValueChange={(value) =>
                  update("enabledMode", value as AiPolicyEditorValue["enabledMode"])
                }
              >
                <SelectTrigger aria-label="启用状态"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {active.scope === "site" ? (
                    <SelectItem value="inherit">继承商家默认</SelectItem>
                  ) : null}
                  <SelectItem value="on">启用</SelectItem>
                  <SelectItem value="off">停用</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>自动回复</Label>
              <Select
                value={active.autoReply}
                onValueChange={(value) =>
                  update("autoReply", value as AiPolicyAutoReply)
                }
              >
                <SelectTrigger aria-label="自动回复"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">跟随平台</SelectItem>
                  <SelectItem value="off">不自动回复</SelectItem>
                  <SelectItem value="no_agent">仅无客服在线时</SelectItem>
                  <SelectItem value="always">每条访客消息都回复</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="merchant-ai-name">AI 显示名称</Label>
              <Input
                id="merchant-ai-name"
                value={active.assistantName}
                maxLength={40}
                placeholder="留空则继承平台设置"
                onChange={(event) => update("assistantName", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>工具权限</Label>
              <Select
                value={active.toolsMode}
                onValueChange={(value) =>
                  update("toolsMode", value as AiPolicyEditorValue["toolsMode"])
                }
              >
                <SelectTrigger aria-label="工具权限"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">继承上级</SelectItem>
                  <SelectItem value="on">允许只读与操作工具</SelectItem>
                  <SelectItem value="off">仅普通对话</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>会话操作权限</Label>
              <Select
                value={active.mutationsMode}
                onValueChange={(value) =>
                  update("mutationsMode", value as AiPolicyEditorValue["mutationsMode"])
                }
              >
                <SelectTrigger aria-label="会话操作权限"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">继承上级</SelectItem>
                  <SelectItem value="on">允许转人工与打标签</SelectItem>
                  <SelectItem value="off">只允许查询</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>超额处理</Label>
              <Select
                value={active.overLimitAction}
                onValueChange={(value) =>
                  update("overLimitAction", value as AiPolicyEditorValue["overLimitAction"])
                }
              >
                <SelectTrigger aria-label="超额处理"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {active.scope === "site" ? (
                    <SelectItem value="inherit">继承商家默认</SelectItem>
                  ) : null}
                  <SelectItem value="skip">停止自动回复，等待人工</SelectItem>
                  <SelectItem value="handoff">写入内部备注并升高优先级</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="merchant-ai-prompt">系统提示词</Label>
            <Textarea
              id="merchant-ai-prompt"
              rows={10}
              maxLength={4000}
              value={active.systemPrompt}
              placeholder="留空则继承平台设置"
              onChange={(event) => update("systemPrompt", event.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <LimitInput
              label="每月调用次数"
              hint={active.scope === "site" ? "留空继承商家默认；0 表示站点不单独限制" : "留空表示不限额"}
              value={active.monthlyRequestLimit}
              onChange={(value) => update("monthlyRequestLimit", value)}
            />
            <LimitInput
              label="每月 Token"
              hint={active.scope === "site" ? "留空继承商家默认；0 表示站点不单独限制" : "留空表示不限额"}
              value={active.monthlyTokenLimit}
              onChange={(value) => update("monthlyTokenLimit", value)}
            />
            <div className="space-y-2">
              <Label htmlFor="merchant-ai-concurrency">AI 任务并发上限</Label>
              <Input
                id="merchant-ai-concurrency"
                type="number"
                min={1}
                max={8}
                value={active.concurrencyLimit ?? ""}
                placeholder={active.scope === "site" ? "继承" : "2"}
                onChange={(event) =>
                  update(
                    "concurrencyLimit",
                    event.target.value === ""
                      ? null
                      : Math.max(1, Math.min(8, Number(event.target.value) || 1)),
                  )
                }
              />
            </div>
          </div>

          {currentUsage ? (
            <p className="text-muted-foreground text-xs">
              本月站点用量：{currentUsage.requests} 次调用，
              {currentUsage.totalTokens} Token，失败 {currentUsage.failures} 次。
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button type="button" onClick={() => void save()} disabled={saving}>
              <Save className="mr-1.5 size-4" />
              {saving ? "保存中…" : "保存策略"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <UsageCard settings={settings} />
    </div>
  );
}

function LimitInput({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type="number"
        min={0}
        value={value ?? ""}
        placeholder="不限额"
        onChange={(event) =>
          onChange(event.target.value === "" ? null : Number(event.target.value))
        }
      />
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}

function UsageCard({ settings }: { settings: MerchantAiSettings }) {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="text-base">本月 AI 用量</CardTitle>
        <CardDescription>按北京时间自然月统计，包含自动回复和客服建议草稿。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Metric label="调用次数" value={settings.usage.totals.requests} />
          <Metric label="Token" value={settings.usage.totals.totalTokens} />
          <Metric label="失败" value={settings.usage.totals.failures} />
          <Metric label="统计月份" value={settings.usage.month} />
        </div>
        <div className="space-y-2">
          {settings.usage.sites.map((site) => (
            <div
              key={site.siteId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <span className="font-medium">{site.siteName}</span>
              <span className="text-muted-foreground">
                {site.requests} 次 · {site.totalTokens} Token · 失败 {site.failures}
              </span>
            </div>
          ))}
          {settings.usage.sites.length === 0 ? (
            <p className="text-muted-foreground text-sm">本月还没有 AI 调用。</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function scopeKey(policy: AiPolicyEditorValue): string {
  return `${policy.scope}:${policy.siteId ?? "tenant"}`;
}
