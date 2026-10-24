"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  followUpLocalTime,
  parseFollowUpLocal,
  type FollowUpAction,
  type FollowUpDetails,
} from "@/lib/follow-ups";

export function useFollowUpEditor({
  conversationId,
  refreshList,
}: {
  conversationId: string;
  refreshList: boolean;
}) {
  const [details, setDetails] = useState<FollowUpDetails | null>(null);
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const mutation = useRef(false);
  const load = useCallback(
    async (clearFeedback = true) => {
      controller.current?.abort();
      const request = new AbortController();
      controller.current = request;
      setLoading(true);
      if (clearFeedback) {
        setError("");
        setSuccess("");
      }
      try {
        const response = await fetch(
          `/api/agent/conversations/${conversationId}/follow-up`,
          { cache: "no-store", signal: request.signal },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "加载失败，请重试");
        if (request.signal.aborted) return;
        setDetails(data);
        setNote(data.task?.note ?? "");
        setDue(
          followUpLocalTime(
            data.task?.dueAt ?? new Date(Date.now() + 86400000),
          ),
        );
        setOwnerId(data.task?.ownerId ?? data.defaultOwnerId);
      } catch (err) {
        if (!request.signal.aborted)
          setError(err instanceof Error ? err.message : "加载失败，请重试");
      } finally {
        if (!request.signal.aborted) setLoading(false);
      }
    },
    [conversationId],
  );
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, [load]);
  async function submit(action: FollowUpAction["action"]) {
    if (!details || mutation.current) return;
    let input: FollowUpAction;
    try {
      input =
        action === "save"
          ? {
              action,
              expectedVersion: details.task?.version ?? 0,
              ownerId,
              note,
              dueAt: parseFollowUpLocal(due),
            }
          : { action, expectedVersion: details.task?.version ?? 0 };
    } catch (err) {
      setError(err instanceof Error ? err.message : "跟进时间无效");
      return;
    }
    mutation.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(
        `/api/agent/conversations/${conversationId}/follow-up`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "操作失败，请稍后重试");
      window.dispatchEvent(new Event("beesupport:followups-changed"));
      if (refreshList) {
        window.location.reload();
        return;
      }
      if (alive.current) {
        setSuccess(
          action === "save"
            ? "跟进任务已保存"
            : action === "complete"
              ? "跟进任务已完成"
              : "跟进任务已取消",
        );
        await load(false);
      }
    } catch (err) {
      if (alive.current)
        setError(err instanceof Error ? err.message : "操作失败，请稍后重试");
    } finally {
      mutation.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const task = details?.task;
  return {
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
  };
}
