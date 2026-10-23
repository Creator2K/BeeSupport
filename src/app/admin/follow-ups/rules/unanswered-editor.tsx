"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { UnansweredRuleDetails } from "@/lib/unanswered";

export function UnansweredEditor({
  siteId,
  initial,
}: {
  siteId: string;
  initial: UnansweredRuleDetails;
}) {
  const [rule, setRule] = useState(initial.rule),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(""),
    [conflict, setConflict] = useState(false);
  const submitting = useRef(false),
    ownerAvailable = initial.owners.some((owner) => owner.id === rule.ownerId);
  return (
    <form
      aria-label="长时间未回复提醒规则"
      className="max-w-2xl space-y-5 rounded-lg border bg-card p-4 sm:p-6"
      onSubmit={async (event) => {
        event.preventDefault();
        if (submitting.current || conflict) return;
        submitting.current = true;
        setPending(true);
        setError("");
        setSaved("");
        try {
          const response = await fetch(
            `/api/admin/sites/${encodeURIComponent(siteId)}/unanswered-rule`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                enabled: rule.enabled,
                ownerId: rule.ownerId,
                delayMinutes: rule.delayMinutes,
                recipientMode: rule.recipientMode,
                expectedVersion: rule.version,
              }),
            },
          );
          const data = await response.json();
          if (!response.ok) {
            if (response.status === 409) setConflict(true);
            throw new Error(
              data.issues?.[0]?.message || data.error || "保存失败，请重试",
            );
          }
          setRule(data.rule);
          setSaved(
            data.rule.enabled
              ? "未回复提醒规则已保存。新开启时，仅提醒之后开始的等待轮次。"
              : "未回复提醒已关闭，已有记录保留在历史中。",
          );
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "网络异常，请重试");
        } finally {
          submitting.current = false;
          setPending(false);
        }
      }}
    >
      <h2 className="text-base font-semibold">长时间未回复提醒</h2>
      <p className="text-sm leading-6 text-muted-foreground">
        访客发来消息后一直未获得人工回复，超过等待时长时，在工作台提醒负责人。
      </p>
      <fieldset
        disabled={pending || conflict}
        className="space-y-5"
        onChange={() => setSaved("")}
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(event) =>
              setRule({ ...rule, enabled: event.target.checked })
            }
          />
          启用未回复提醒
        </label>
        <div className="space-y-2">
          <label htmlFor="unanswered-delay" className="block text-sm">
            等待时长（分钟）
          </label>
          <input
            id="unanswered-delay"
            type="number"
            min={1}
            max={10080}
            step={1}
            required
            value={Number.isNaN(rule.delayMinutes) ? "" : rule.delayMinutes}
            onChange={(event) =>
              setRule({ ...rule, delayMinutes: event.target.valueAsNumber })
            }
            className="h-10 w-full rounded-md border bg-background px-3"
          />
          <p className="text-xs text-muted-foreground">
            可设置 1 分钟至 7 天，建议先设为 10 分钟。
          </p>
        </div>
        <div className="space-y-2">
          <label htmlFor="unanswered-mode" className="block text-sm">
            提醒对象
          </label>
          <select
            id="unanswered-mode"
            className="h-10 w-full min-w-0 rounded-md border bg-background px-3"
            value={rule.recipientMode}
            onChange={(event) =>
              setRule({
                ...rule,
                recipientMode: event.target.value as typeof rule.recipientMode,
              })
            }
          >
            <option value="ASSIGNED_OR_OWNER">
              优先当前接待客服，无有效接待客服时提醒默认负责人
            </option>
            <option value="OWNER">始终提醒默认负责人</option>
          </select>
        </div>
        <div className="space-y-2">
          <label htmlFor="unanswered-owner" className="block text-sm">
            默认提醒负责人
          </label>
          <select
            id="unanswered-owner"
            required={rule.enabled}
            value={rule.ownerId}
            onChange={(event) =>
              setRule({ ...rule, ownerId: event.target.value })
            }
            className="h-10 w-full min-w-0 rounded-md border bg-background px-3"
          >
            <option value="">请选择默认负责人</option>
            {rule.ownerId && !ownerAvailable && (
              <option value={rule.ownerId}>原负责人不可用，请重新选择</option>
            )}
            {initial.owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
          {rule.enabled && !ownerAvailable && (
            <p
              role="alert"
              className="text-sm text-amber-800 dark:text-amber-300"
            >
              默认负责人未配置或已失效；没有有效接待客服时无法生成提醒，请重新选择。
            </p>
          )}
        </div>
      </fieldset>
      <p className="text-xs leading-6 text-muted-foreground">
        同一轮等待只提醒一次，访客连续补发消息不会重新计时。客服公开回复或结束会话后停止提醒；已读、内部备注及
        AI
        自动回复不算人工回复。新开启或重新开启时不补发之前的等待轮次。定时检查通常在到期后
        30
        秒内生成站内提醒，不发送邮件或访客消息。调整接收人只影响尚未生成的提醒，已有记录保留原接收人。
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-green-800 dark:text-green-300">
          {saved}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || conflict}>
          {pending ? "保存中…" : "保存未回复提醒规则"}
        </Button>
        {conflict && (
          <Button
            type="button"
            variant="outline"
            onClick={() => window.location.reload()}
          >
            重新加载配置
          </Button>
        )}
      </div>
    </form>
  );
}
