"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { followUpLocalTime, followUpStatuses } from "@/lib/follow-ups";
import { useFollowUpEditor } from "./use-follow-up-editor";

export function FollowUpEditor({
  conversationId,
  refreshList,
}: {
  conversationId: string;
  refreshList: boolean;
}) {
  const {
    details,
    task,
    note,
    setNote,
    due,
    setDue,
    ownerId,
    setOwnerId,
    loading,
    busy,
    error,
    success,
    load,
    submit,
  } = useFollowUpEditor({ conversationId, refreshList });

  return (
    <div className="space-y-4">
      {loading && (
        <p role="status" className="text-sm">
          正在加载跟进任务…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {error}
        </p>
      )}
      <p role="status" className="text-sm">
        {success}
      </p>
      {!loading && details && (
        <>
          <p className="text-sm">
            当前状态：{task ? followUpStatuses[task.status] : "尚未安排"}
            {task?.ownerName
              ? ` · ${task.ownerName}`
              : task
                ? " · 负责人已删除，请管理员重新安排"
                : ""}
          </p>
          {!details.canEdit ? (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <p className="whitespace-pre-wrap break-all">{task?.note}</p>
              <p>
                跟进时间：
                {task ? followUpLocalTime(task.dueAt).replace("T", " ") : "—"}
                （北京时间）
              </p>
              <p className="text-muted-foreground">
                由负责人或管理员处理此任务。
              </p>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submit("save");
              }}
            >
              <fieldset disabled={busy} className="min-w-0 space-y-4">
                <legend className="sr-only">跟进任务设置</legend>
                <div className="space-y-2">
                  <Label htmlFor="followup-note">跟进事项</Label>
                  <Textarea
                    id="followup-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    required
                    maxLength={1000}
                    rows={3}
                    placeholder="例如：核对退款进度后联系访客"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="followup-due">跟进时间（北京时间）</Label>
                  <Input
                    id="followup-due"
                    type="datetime-local"
                    value={due}
                    onChange={(event) => setDue(event.target.value)}
                    required
                    className="min-w-0 max-w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="followup-owner">负责人</Label>
                  <select
                    id="followup-owner"
                    value={ownerId}
                    onChange={(event) => setOwnerId(event.target.value)}
                    required
                    className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="">请选择负责人</option>
                    {ownerId &&
                      !details.owners.some((owner) => owner.id === ownerId) && (
                        <option value={ownerId} disabled>
                          原负责人已不可分配，请重新选择
                        </option>
                      )}
                    {details.owners.map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.name}
                      </option>
                    ))}
                  </select>
                </div>
                {details.owners.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    没有可分配的成员，请管理员先为客服授权本站点。
                  </p>
                )}
                <p className="text-xs leading-5 text-muted-foreground">
                  请安排未来 365
                  天内的时间。普通客服只能为自己安排；完成或取消任务后仍保留处理记录。重新安排会恢复为待跟进。
                </p>
                <Button type="submit" disabled={busy || !details.owners.length}>
                  {busy
                    ? "处理中…"
                    : task && task.status !== "OPEN"
                      ? "重新安排跟进"
                      : "保存跟进"}
                </Button>
              </fieldset>
            </form>
          )}
          {details.canEdit && task?.status === "OPEN" && (
            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button
                type="button"
                disabled={busy}
                onClick={() => void submit("complete")}
              >
                标记已完成
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void submit("cancel")}
              >
                取消跟进
              </Button>
            </div>
          )}
        </>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy || loading}
        onClick={() => void load()}
      >
        刷新任务
      </Button>
    </div>
  );
}
