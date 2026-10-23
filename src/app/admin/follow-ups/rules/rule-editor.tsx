"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { FollowUpRuleDetails } from "@/lib/follow-up-rules";

export function FollowUpRuleEditor({
  initial,
}: {
  initial: FollowUpRuleDetails;
}) {
  const [rule, setRule] = useState(initial.rule),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(""),
    [conflict, setConflict] = useState(false);
  const submitting = useRef(false);
  const ownerAvailable = initial.owners.some(
    (owner) => owner.id === rule.ownerId,
  );
  return (
    <form
      aria-label="离线留言自动跟进规则"
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
            `/api/admin/sites/${encodeURIComponent(initial.site.id)}/follow-up-rule`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                enabled: rule.enabled,
                ownerId: rule.ownerId,
                delayMinutes: rule.delayMinutes,
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
              ? "自动跟进规则已启用，仅对之后新建的离线会话生效。"
              : "自动跟进规则已关闭，已有跟进任务保留。请到跟进待办中处理已有任务。",
          );
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "网络异常，请重试");
        } finally {
          submitting.current = false;
          setPending(false);
        }
      }}
    >
      <h2 className="text-base font-semibold">
        {initial.site.name} · 离线留言
      </h2>
      {!initial.site.active && (
        <p className="text-sm text-amber-800 dark:text-amber-300">
          站点已停用，恢复启用后才会接收新的咨询并执行规则。
        </p>
      )}
      <fieldset disabled={pending || conflict} className="space-y-5">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(event) => {
              setSaved("");
              setRule({ ...rule, enabled: event.target.checked });
            }}
          />
          启用离线留言自动跟进
        </label>
        <div className="space-y-2">
          <label htmlFor="rule-owner" className="block text-sm">
            默认负责人
          </label>
          <select
            id="rule-owner"
            value={rule.ownerId}
            required={rule.enabled}
            className="h-10 w-full min-w-0 rounded-md border bg-background px-3"
            onChange={(event) => {
              setSaved("");
              setRule({ ...rule, ownerId: event.target.value });
            }}
          >
            <option value="">请选择负责人</option>
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
              负责人未配置或已失效，当前规则无法自动创建任务。请选择本商家启用且有该站点权限的成员。
            </p>
          )}
        </div>
        <div className="space-y-2">
          <label htmlFor="rule-delay" className="block text-sm">
            处理时限（分钟）
          </label>
          <input
            id="rule-delay"
            type="number"
            min={1}
            max={10080}
            step={1}
            required
            value={Number.isNaN(rule.delayMinutes) ? "" : rule.delayMinutes}
            onChange={(event) => {
              setSaved("");
              setRule({ ...rule, delayMinutes: event.target.valueAsNumber });
            }}
            className="h-10 w-full rounded-md border bg-background px-3"
            aria-describedby="rule-delay-help"
          />
          <p
            id="rule-delay-help"
            className="text-xs leading-5 text-muted-foreground"
          >
            收到新离线留言后，须在所设时限内跟进。可设置 1～10,080 分钟（7
            天），例如 60 分钟。逾期后在工作台显示为已到期待办。
          </p>
        </div>
      </fieldset>
      <p className="text-xs leading-6 text-muted-foreground">
        仅对新建的离线会话生成一条内部跟进；已有会话续发消息不会重复生成，历史留言不会补建，已有手动任务不会被覆盖。关闭规则不会取消已有任务。负责人停用、删除或失去站点权限时暂停创建，请管理员重新选择。任务仅在站内提示，不额外发送访客消息或邮件。
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
          {pending ? "保存中…" : "保存自动跟进规则"}
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
