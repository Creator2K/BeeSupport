"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/components/locale-provider";

import type {
  CannedItem,
} from "@/components/agent/workbench-types";
import type { SerializedConversation } from "@/lib/realtime/types";
import { appendCannedText } from "@/lib/canned";

export function useWorkbenchCanned({
  activeConversation,
  activeIdRef,
  draftsRef,
  onDraftChange,
  onFocus,
}: {
  activeConversation: SerializedConversation | null;
  activeIdRef: { current: string | null };
  draftsRef: { current: Record<string, string> };
  onDraftChange: (conversationId: string, value: string) => void;
  onFocus: () => void;
}) {
  const t = useT();
  const [result, setResult] = useState<{
    key: string;
    siteId: string;
    items: CannedItem[];
    categories: string[];
    hasMore: boolean;
    error: boolean;
  }>({
    key: "",
    siteId: "",
    items: [],
    categories: [],
    hasMore: false,
    error: false,
  });
  const [category, setCategory] = useState("");
  const [inserting, setInserting] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const insertRef = useRef(false);

  const siteId = activeConversation?.siteId ?? "";
  const key = JSON.stringify([siteId, query, category]);

  function changeOpen(next: boolean) {
    if (next) setResult((previous) => ({ ...previous, key: "" }));
    setOpen(next);
  }

  useEffect(() => {
    if (!open || !siteId) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams({ siteId, query, category });
          const response = await fetch(`/api/agent/canned?${params}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("Unable to load replies");
          const data = (await response.json()) as {
            items: CannedItem[];
            categories: string[];
            hasMore: boolean;
          };
          if (!controller.signal.aborted) {
            setResult({ ...data, key, siteId, error: false });
          }
        } catch {
          if (!controller.signal.aborted) {
            setResult({
              key,
              siteId,
              items: [],
              categories: [],
              hasMore: false,
              error: true,
            });
          }
        }
      })();
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, siteId, query, category, key]);

  async function insert(item: CannedItem) {
    if (!activeConversation || insertRef.current) return;
    const conversationId = activeConversation.id;
    insertRef.current = true;
    setInserting(true);
    try {
      const response = await fetch("/api/agent/canned", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, siteId: activeConversation.siteId }),
      });
      const payload = (await response.json()) as {
        item?: CannedItem;
        error?: string;
      };
      if (!response.ok || !payload.item) {
        throw new Error(payload.error || t("common.operationFailed"));
      }
      const next = appendCannedText(
        draftsRef.current[conversationId] ?? "",
        payload.item.content,
      );
      onDraftChange(conversationId, next);
      if (activeIdRef.current === conversationId) {
        setOpen(false);
        setQuery("");
        requestAnimationFrame(onFocus);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("common.operationFailed"),
      );
    } finally {
      insertRef.current = false;
      setInserting(false);
    }
  }

  function reset() {
    setOpen(false);
    setQuery("");
    setCategory("");
  }

  return {
    open,
    setOpen: changeOpen,
    query,
    setQuery,
    category,
    setCategory,
    inserting,
    categories: result.siteId === siteId ? result.categories : [],
    items: result.key === key ? result.items : [],
    loading: open && result.key !== key,
    error: result.error,
    hasMore: result.hasMore,
    insert,
    reset,
  };
}