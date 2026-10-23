"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { saveReminderSettingsAction } from "@/server/actions/reminders";
import { callClientAction } from "@/lib/client-action";
export function ReminderSettings({
  initial,
  smtpReady,
}: {
  initial: {
    revision: string;
    settings: { enabled: boolean; mailEnabled: boolean; leadDays: number };
  };
  smtpReady: boolean;
}) {
  const [settings, setSettings] = useState(initial.settings),
    [revision, setRevision] = useState(initial.revision),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="max-w-2xl space-y-5 rounded-xl border p-4 sm:p-6"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError("");
        const result = await callClientAction(
          () => saveReminderSettingsAction(settings, revision),
          "保存失败，请重试",
        );
        setPending(false);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if ("revision" in result) setRevision(result.revision);
        toast.success(result.message);
      }}
    >
      <fieldset disabled={pending} className="space-y-5">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) =>
              setSettings({ ...settings, enabled: event.target.checked })
            }
          />
          启用到期提醒
        </label>
        <div className="space-y-2">
          <Label htmlFor="reminder-lead-days">提前提醒时间</Label>
          <select
            id="reminder-lead-days"
            className="block h-10 w-full rounded-md border bg-background px-3"
            value={settings.leadDays}
            onChange={(event) =>
              setSettings({ ...settings, leadDays: Number(event.target.value) })
            }
          >
            <option value={7}>提前 7 天</option>
            <option value={14}>提前 14 天</option>
            <option value={30}>提前 30 天</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.mailEnabled}
            onChange={(event) =>
              setSettings({ ...settings, mailEnabled: event.target.checked })
            }
          />
          同时发送邮件给商家管理员
        </label>
        <p className="text-xs leading-6 text-muted-foreground">
          {smtpReady
            ? "SMTP 已配置，开启后会向启用中的商家管理员发送提醒邮件。"
            : "SMTP 尚未配置；站内提醒正常生成，邮件将在配置可用后排队发送。请先到系统设置配置 SMTP。"}
        </p>
      </fieldset>
      <p className="text-xs leading-6 text-muted-foreground">
        定时任务分批检查有效商家，在到期前 30 / 14 / 7 / 3 / 1
        天中符合所选范围的阶段各提醒一次，到期后 7
        天内补发一次。同一有效期、同一阶段不会重复生成。续期后，旧有效期的提醒自动隐藏，未发送的旧邮件会跳过；长期有效、待审核和停用商家不提醒。
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "保存中…" : "保存提醒配置"}
      </Button>
    </form>
  );
}
