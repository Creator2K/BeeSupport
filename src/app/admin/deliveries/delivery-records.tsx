"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deliveryKinds, deliveryStates } from "@/lib/deliveries";
import { callClientAction } from "@/lib/client-action";
import { retryDeliveryAction } from "@/server/actions/deliveries";
import type { DeliveryList } from "@/server/services/deliveries";

const date = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
export function DeliveryRefresh() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() => start(() => router.refresh())}
    >
      {pending ? "刷新中…" : "刷新状态"}
    </Button>
  );
}
export function DeliveryRecords({ rows }: { rows: DeliveryList["rows"] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<DeliveryList["rows"][number] | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  async function retry() {
    if (!selected || pending) return;
    setPending(true);
    const result = await callClientAction(
      () =>
        retryDeliveryAction({
          id: selected.id,
          updatedAt: selected.updatedAt,
          manualRetries: selected.manualRetries,
        }),
      "重新排队失败，请稍后重试",
    );
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message ?? "任务已重新排队");
    setSelected(null);
    router.refresh();
  }
  return (
    <>
      <div className="space-y-3">
        {rows.map((row) => (
          <article
            key={row.id}
            className="rounded-lg border bg-card p-4"
            aria-label={`通知任务 ${row.id}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">
                  {row.kind in deliveryKinds
                    ? deliveryKinds[row.kind as keyof typeof deliveryKinds]
                    : "未知通知类型"}
                </p>
                <p className="break-all font-mono text-xs text-muted-foreground">
                  {row.id}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={row.state === "FAILED" ? "destructive" : "secondary"}
                >
                  {row.state in deliveryStates
                    ? deliveryStates[row.state as keyof typeof deliveryStates]
                    : "未知状态"}
                </Badge>
                {row.canRetry && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => setSelected(row)}
                  >
                    重试任务
                  </Button>
                )}
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">创建时间</dt>
                <dd className="mt-1">{date(row.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">累计尝试 / 本轮尝试</dt>
                <dd className="mt-1">
                  {row.totalAttempts} / {row.attempts}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">人工重试</dt>
                <dd className="mt-1">{row.manualRetries} 次</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {row.completedAt ? "处理完成" : "下次可处理"}
                </dt>
                <dd className="mt-1">
                  {date(row.completedAt ?? row.availableAt)}
                </dd>
              </div>
            </dl>
            {row.diagnostic && (
              <p
                className={`mt-3 rounded-md p-2 text-xs leading-5 ${row.state === "FAILED" ? "bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300" : "bg-muted text-foreground/80"}`}
              >
                {row.diagnostic}
              </p>
            )}
          </article>
        ))}
      </div>
      <AlertDialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open && !pending) setSelected(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重新发送这条通知？</AlertDialogTitle>
            <AlertDialogDescription>
              后台会再次发送，收件方可能收到重复通知。发送中的任务不能人工重试；账号链接和到期提醒将在发送前再次检查有效性。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="break-all font-mono text-xs text-muted-foreground">
            {selected?.id}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                void retry();
              }}
            >
              {pending ? "排队中…" : "确认重新排队"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
