"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  collectVisitorEnv,
  mergeVisitorEnv,
  pickVisitorEnv,
  type VisitorEnv,
} from "@/lib/visitor-env";

export type StoredIdentity = {
  token: string;
  email: string;
  name: string | null;
};

export function useWidgetTracking({
  siteKey,
  embedToken,
  pageUrl,
  pageTitle,
  referrer,
  host,
  token,
  unread,
  setUnread,
  conversationIdRef,
}: {
  siteKey: string;
  embedToken: string;
  pageUrl: string;
  pageTitle: string;
  referrer: string;
  host: string;
  token: string | null;
  unread: number;
  setUnread: (value: number) => void;
  conversationIdRef: { current: string | null };
}) {
  const [page, setPage] = useState({ url: pageUrl, title: pageTitle });
  const [parentOpened, setParentOpened] = useState(false);
  const envRef = useRef<VisitorEnv>({});
  const trackingLocalKeyRef = useRef("");
  const tokenRef = useRef<string | null>(token);
  tokenRef.current = token;
  const pageRef = useRef(page);
  pageRef.current = page;

  const collectEnv = useCallback(
    (extra: VisitorEnv = {}): VisitorEnv =>
      mergeVisitorEnv(
        mergeVisitorEnv(
          collectVisitorEnv({
            pageUrl: page.url || undefined,
            pageTitle: page.title || undefined,
            referrer: referrer || undefined,
            host: host || undefined,
          }),
          envRef.current,
        ),
        extra,
      ),
    [page.url, page.title, referrer, host],
  );
  const collectEnvRef = useRef(collectEnv);
  collectEnvRef.current = collectEnv;

  useEffect(() => {
    envRef.current = collectVisitorEnv({
      pageUrl,
      pageTitle,
      referrer,
      host,
    });
  }, [pageUrl, pageTitle, referrer, host]);
  const reportTrack = useCallback(
    async (target?: { url: string; title: string }, env?: VisitorEnv) => {
      const visitorToken = tokenRef.current;
      const current = target ?? pageRef.current;
      if (!current.url) return;
      if (!visitorToken) {
        if (!trackingLocalKeyRef.current) return;
        await fetch("/api/widget/visit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-beesupport-embed": embedToken,
          },
          body: JSON.stringify({
            key: siteKey,
            localKey: trackingLocalKeyRef.current,
            pageUrl: current.url,
            pageTitle: current.title || undefined,
            referrer: referrer || undefined,
            env: env ?? collectEnvRef.current(),
          }),
        }).catch(() => undefined);
        return;
      }

      await fetch("/api/widget/track", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${visitorToken}`,
        },
        body: JSON.stringify({
          pageUrl: current.url,
          pageTitle: current.title || undefined,
          env: env ?? collectEnvRef.current(),
        }),
      }).catch(() => undefined);
    },
    [embedToken, siteKey, referrer],
  );
  const reportTrackRef = useRef(reportTrack);
  reportTrackRef.current = reportTrack;

  const identityStorageKey = siteKey ? `beesupport:visitor:${siteKey}` : "";
  const localKeyStorageKey = siteKey ? `beesupport:localKey:${siteKey}` : "";

  const postToParent = useCallback(
    (message: Record<string, unknown>) => {
      if (typeof window === "undefined" || window.parent === window) return;
      window.parent.postMessage(message, host || "*");
    },
    [host],
  );

  const readIdentity = useCallback((): StoredIdentity | null => {
    if (!identityStorageKey) return null;
    try {
      const raw = window.localStorage.getItem(identityStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredIdentity;
      return parsed?.token ? parsed : null;
    } catch {
      return null;
    }
  }, [identityStorageKey]);

  const ensureLocalKey = useCallback((): string => {
    if (!localKeyStorageKey) return `anon-${Date.now()}-0000`;
    try {
      const existing = window.localStorage.getItem(localKeyStorageKey);
      if (existing && existing.length >= 8 && existing.length <= 64) {
        return existing;
      }
    } catch {
      /* Storage may be disabled in embedded browsers. */
    }
    const generated =
      trackingLocalKeyRef.current ||
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    trackingLocalKeyRef.current = generated;
    try {
      window.localStorage.setItem(localKeyStorageKey, generated);
    } catch {
      /* Keep an in-memory identity for this window. */
    }
    return generated;
  }, [localKeyStorageKey]);
  const markRead = useCallback(
    (conversationId: string) => {
      setUnread(0);
      void fetch("/api/widget/read", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({ conversationId }),
      }).catch(() => undefined);
    },
    [token, setUnread],
  );

  useEffect(() => {
    postToParent({ type: "beesupport:unread", count: unread });
  }, [unread, postToParent]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string } | null;
      if (
        event.source !== window.parent ||
        (host && event.origin !== host) ||
        !data ||
        typeof data !== "object"
      ) {
        return;
      }

      if (data.type === "beesupport:opened") {
        setParentOpened(true);
        const conversationId = conversationIdRef.current;
        if (conversationId) markRead(conversationId);
      } else if (data.type === "beesupport:closed") {
        setParentOpened(false);
      } else if (data.type === "beesupport:env") {
        const incoming = (data as { env?: unknown }).env;
        envRef.current = mergeVisitorEnv(
          envRef.current,
          pickVisitorEnv(incoming ?? data),
        );
        void reportTrack(undefined, envRef.current);
      } else if (data.type === "beesupport:navigate") {
        const next = {
          url: String((data as { page?: unknown }).page ?? ""),
          title: String((data as { title?: unknown }).title ?? ""),
        };
        setPage(next);
        void reportTrack(next);
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [markRead, reportTrack, host, conversationIdRef]);

  useEffect(() => {
    const onVisible = () => {
      if (
        parentOpened &&
        document.visibilityState === "visible" &&
        conversationIdRef.current
      ) {
        markRead(conversationIdRef.current);
      }
    };
    if (window.parent === window) setParentOpened(true);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [parentOpened, markRead, conversationIdRef]);

  return {
    page,
    parentOpened,
    collectEnv,
    reportTrack,
    reportTrackRef,
    postToParent,
    readIdentity,
    ensureLocalKey,
    markRead,
    identityStorageKey,
    localKeyStorageKey,
  };
}