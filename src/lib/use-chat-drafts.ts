"use client";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  draftPrefix,
  draftLogoutKey,
  loadDrafts,
  storeDraft,
} from "./chat-drafts";
export function useChatDrafts(userId: string) {
  const [state, setState] = useState<{
    owner: string;
    drafts: Record<string, string>;
  }>({ owner: "", drafts: {} });
  const latest = useRef(state);
  latest.current = state;
  const stored = useRef<Record<string, string>>({});
  useEffect(() => {
    let drafts: Record<string, string> = {};
    try {
      drafts = loadDrafts(localStorage, userId);
    } catch {}
    stored.current = drafts;
    latest.current = { owner: userId, drafts };
    setState(latest.current);
    const flush = () => {
      if (latest.current.owner !== userId) return;
      const next = latest.current.drafts;
      try {
        for (const id of new Set([
          ...Object.keys(stored.current),
          ...Object.keys(next),
        ]))
          if (next[id] !== stored.current[id])
            storeDraft(localStorage, userId, id, next[id] ?? "");
      } catch {}
      stored.current = next;
    };
    const cleared = (event: Event) => {
      if ((event as CustomEvent).detail !== userId) return;
      stored.current = {};
      latest.current = { owner: userId, drafts: {} };
      setState(latest.current);
    };
    const sync = (event: StorageEvent) => {
      if (event.key === draftLogoutKey(userId)) {
        stored.current = {};
        latest.current = { owner: userId, drafts: {} };
        setState(latest.current);
        return;
      }
      if (event.key !== null && !event.key.startsWith(draftPrefix(userId)))
        return;
      const next = loadDrafts(localStorage, userId),
        merged = { ...next };
      for (const id of new Set([
        ...Object.keys(stored.current),
        ...Object.keys(latest.current.drafts),
      ])) {
        if (latest.current.drafts[id] !== stored.current[id]) {
          if (latest.current.drafts[id]) merged[id] = latest.current.drafts[id];
          else delete merged[id];
        }
      }
      stored.current = next;
      latest.current = { owner: userId, drafts: merged };
      setState(latest.current);
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("storage", sync);
    window.addEventListener("beesupport:drafts-cleared", cleared);
    const timer = setInterval(flush, 300);
    return () => {
      clearInterval(timer);
      flush();
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("storage", sync);
      window.removeEventListener("beesupport:drafts-cleared", cleared);
    };
  }, [userId]);
  const setDrafts: Dispatch<SetStateAction<Record<string, string>>> = (
    update,
  ) =>
    setState((previous) => {
      if (previous.owner !== userId) return previous;
      const drafts =
        typeof update === "function" ? update(previous.drafts) : update;
      const next = { owner: userId, drafts };
      latest.current = next;
      return next;
    });
  return [
    state.owner === userId ? state.drafts : {},
    setDrafts,
    state.owner === userId,
  ] as const;
}
