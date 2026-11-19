"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { updateErrors, type UpdateError } from "@/lib/online-update";
import { callClientAction } from "@/lib/client-action";
import { requestOnlineUpdate } from "@/server/actions/online-update";

type Props = {
  connected: boolean;
  image: boolean;
  available: boolean;
  update: { version: string; url: string } | null;
  job?: {
    version: string;
    status: "queued" | "running" | "success" | "failed";
    error?: UpdateError;
  };
};

export function OnlineUpdatePanel({ connected, image, available, update, job }: Props) {
  const router = useRouter();
  const [refreshing, refresh] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const working = job?.status === "queued" || job?.status === "running";
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [router, working]);

  async function start() {
    if (!update || submitting) return;
    setSubmitting(true);
    const result = await callClientAction(
      () => requestOnlineUpdate(update.version),
      "更新请求失败，请稍后重试。",
    );
    setSubmitting(false);
    setMessage(result.ok ? "" : result.error);
    if (result.ok) router.refresh();
  }

  return (
    <section aria-labelledby="online-update-title" className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 id="online-update-title" className="text-lg font-semibold">在线更新</h2>
          {update ? (
            <p className="text-sm">
              可更新至 <a href={update.url} className="font-mono font-medium underline">{update.version}</a>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {available ? "当前已是最新发布版本。" : "暂时无法检查 GitHub 发布版本。"}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={refreshing} onClick={() => refresh(() => router.refresh())}>
            {refreshing ? "检查中…" : "检查更新"}
          </Button>
          {update && (
            <Button onClick={start} disabled={!image || !connected || working || submitting}>
              {working ? "更新中…" : "立即更新"}
            </Button>
          )}
        </div>
      </div>
      {!image ? (
        <p className="text-sm text-muted-foreground">在线更新需要 BeeSupport 的正式发布镜像。</p>
      ) : !connected && !working ? (
        <p className="text-sm text-muted-foreground">
          服务器更新程序未连接。请按
          <a className="underline" href="https://github.com/Creator2K/BeeSupport#启用后台在线更新">部署说明</a>
          完成一次接入。
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          镜像在后台下载，切换时应用可能短暂中断。
        </p>
      )}
      <div className="space-y-1 text-sm" role="status">
        {job?.status === "queued" && <p>等待服务器开始更新 {job.version}。</p>}
        {job?.status === "running" && <p>正在下载或启用 {job.version}，本页会自动刷新。</p>}
        {job?.status === "success" && <p>已成功更新到 {job.version}。</p>}
        {job?.status === "failed" && <p>{job.version} 更新失败。{job.error && updateErrors[job.error]}</p>}
        {message && <p>{message}</p>}
      </div>
    </section>
  );
}
