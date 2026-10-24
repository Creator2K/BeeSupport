"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";

import type { Availability, SiteConfig } from "@/components/widget/widget-types";
import { useT } from "@/components/locale-provider";
import { extractClipboardFiles } from "@/lib/clipboard-files";
import {
  mergeMessageSnapshot,
  snapshotHasOlderMessages,
} from "@/lib/realtime/messages";
import type { VisitorConversation } from "@/lib/realtime/public";
import type { SerializedMessage } from "@/lib/realtime/types";
import {
  prepareSendAttempt,
  type SendAttempt,
} from "@/lib/realtime/send-attempt";
import type { ImageGate } from "@/server/services/image-review";

export function useWidgetMessaging({
  token,
  config,
  availability,
  conversation,
  draft,
  messagesRef,
  conversationIdRef,
  setConversation,
  setMessages,
  setDraft,
  setHasOlder,
  scrollToLatest,
}: {
  token: string | null;
  config: SiteConfig | null;
  availability: Availability;
  conversation: VisitorConversation | null;
  draft: string;
  messagesRef: { current: SerializedMessage[] };
  conversationIdRef: { current: string | null };
  setConversation: Dispatch<SetStateAction<VisitorConversation | null>>;
  setMessages: Dispatch<SetStateAction<SerializedMessage[]>>;
  setDraft: Dispatch<SetStateAction<string>>;
  setHasOlder: Dispatch<SetStateAction<boolean>>;
  scrollToLatest: () => void;
}) {
  const t = useT();
  const [sending, setSending] = useState(false);
  const sendAttemptRef = useRef<SendAttempt | null>(null);
  const sendingRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const [imageGate, setImageGate] = useState<ImageGate>({
    enabled: false,
    pending: null,
  });

  const refreshImageGate = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch("/api/widget/images", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (response.ok) setImageGate(await response.json());
    } catch {
      /* Keep the last known gate; the server still enforces it. */
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void refreshImageGate();
    const timer = setInterval(() => void refreshImageGate(), 15000);
    return () => clearInterval(timer);
  }, [token, refreshImageGate]);

  async function sendUploadedAttachment(
    attachmentId: string,
    targetId?: string | null,
  ): Promise<boolean> {
    const id = targetId || conversationIdRef.current;
    const response = await fetch("/api/widget/conversation", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        conversationId: id || undefined,
        body: "",
        attachmentIds: [attachmentId],
        clientId: `image:${attachmentId}`,
        ...(!id
          ? { source: availability.online ? "WIDGET" : "OFFLINE_FORM" }
          : {}),
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      toast.error(data.error || t("widget.sendFailed"));
      await refreshImageGate();
      return false;
    }
    const data = (await response.json()) as {
      conversation?: VisitorConversation | null;
      messages?: SerializedMessage[];
    };
    scrollToLatest();
    setConversation(data.conversation ?? null);
    setMessages((previous) =>
      mergeMessageSnapshot(previous, data.messages ?? []),
    );
    setImageGate((previous) =>
      previous.pending?.id === attachmentId
        ? {
            ...previous,
            pending: {
              ...previous.pending,
              sent: true,
              conversationId: data.conversation?.id ?? null,
            },
          }
        : previous,
    );
    await refreshImageGate();
    return true;
  }

  async function sendMessage() {
    const body = draft.trim();
    if (!body || sendingRef.current || !token) return;

    const attempt = prepareSendAttempt(sendAttemptRef.current, token, body);
    sendAttemptRef.current = attempt;
    const { clientId } = attempt;
    sendingRef.current = true;

    const optimistic: SerializedMessage = {
      id: `tmp-${clientId}`,
      conversationId: conversation?.id ?? "pending",
      sender: "VISITOR",
      type: "TEXT",
      body,
      authorId: null,
      authorName: null,
      createdAt: new Date().toISOString(),
      readByAgentAt: null,
      readByVisitorAt: new Date().toISOString(),
      clientId,
      attachments: [],
      meta: null,
    };

    scrollToLatest();
    setMessages((previous) => [...previous, optimistic]);
    setDraft("");
    setSending(true);

    try {
      const response = await fetch("/api/widget/conversation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(
          conversation
            ? { conversationId: conversation.id, body, clientId }
            : {
                body,
                clientId,
                source: availability.online ? "WIDGET" : "OFFLINE_FORM",
              },
        ),
      });
      const data = (await response.json()) as {
        conversation?: VisitorConversation | null;
        messages?: SerializedMessage[];
        error?: string;
      };
      if (!response.ok) {
        setMessages((previous) =>
          previous.filter((item) => item.id !== `tmp-${clientId}`),
        );
        setDraft((current) => current || body);
        toast.error(data.error ?? t("widget.sendFailed"));
        return;
      }

      sendAttemptRef.current = null;
      setConversation(data.conversation ?? null);
      const current = messagesRef.current;
      setMessages((previous) =>
        mergeMessageSnapshot(
          previous.filter(
            (item) => item.clientId !== clientId || !item.id.startsWith("tmp-"),
          ),
          data.messages ?? [],
        ),
      );
      setHasOlder((previous) =>
        snapshotHasOlderMessages(current, data.messages ?? [], previous),
      );
    } catch {
      setMessages((previous) =>
        previous.filter((item) => item.id !== `tmp-${clientId}`),
      );
      setDraft((current) => current || body);
      toast.error(t("widget.sendFailed"));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function uploadFile(file: File): Promise<boolean> {
    const image = file.type.toLowerCase().startsWith("image/");
    if (image ? !config?.imagesEnabled : !config?.filesEnabled) {
      toast.error(image ? "此站点已关闭图片发送" : "此站点已关闭文件发送");
      return false;
    }
    if (file.size > (config?.maxUploadMB ?? 10) * 1048576) {
      toast.error(`文件不能超过 ${config?.maxUploadMB ?? 10} MB`);
      return false;
    }
    if (!token || uploadingRef.current) return false;
    if (
      file.type.startsWith("image/") &&
      imageGate.enabled &&
      imageGate.pending
    ) {
      toast.error(t("images.oneAtATime"));
      return false;
    }
    uploadingRef.current = true;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/widget/upload", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        toast.error(data.error || t("widget.uploadFailed"));
        await refreshImageGate();
        return false;
      }
      const { attachment } = (await response.json()) as {
        attachment: { id: string; imageReviewState?: string };
      };
      if (attachment.imageReviewState === "PENDING") {
        setImageGate({
          enabled: true,
          pending: { id: attachment.id, sent: false, conversationId: null },
        });
      }
      return await sendUploadedAttachment(attachment.id);
    } catch {
      toast.error(t("widget.uploadFailed"));
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
    return false;
  }

  async function recoverImage(cancel = false) {
    const pending = imageGate.pending;
    if (!token || !pending || pending.sent || uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true);
    try {
      if (cancel) {
        const response = await fetch("/api/widget/images", {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ attachmentId: pending.id }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || t("common.operationFailed"));
        }
        setImageGate(data);
      } else {
        await sendUploadedAttachment(pending.id, pending.conversationId);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("widget.uploadFailed"),
      );
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }

  async function handlePaste(
    event: React.ClipboardEvent<HTMLTextAreaElement>,
  ): Promise<void> {
    const files = extractClipboardFiles(event.clipboardData?.items);
    if (files.length === 0) return;
    if (
      imageGate.enabled &&
      files.filter((file) => file.type.startsWith("image/")).length > 1
    ) {
      event.preventDefault();
      toast.error(t("images.oneAtATime"));
      return;
    }

    event.preventDefault();
    let allSucceeded = true;
    for (const file of files.slice(0, 4)) {
      allSucceeded = (await uploadFile(file)) && allSucceeded;
    }
    if (allSucceeded) toast.success(t("widget.imageAttached"));
  }

  return {
    sending,
    uploading,
    imageGate,
    setImageGate,
    sendMessage,
    uploadFile,
    recoverImage,
    handlePaste,
  };
}