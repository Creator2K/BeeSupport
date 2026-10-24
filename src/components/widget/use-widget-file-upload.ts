"use client";

import { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";

import type { useT } from "@/components/locale-provider";
import type { SiteConfig } from "@/components/widget/widget-types";
import { extractClipboardFiles } from "@/lib/clipboard-files";
import { mergeMessageSnapshot } from "@/lib/realtime/messages";
import type { VisitorConversation } from "@/lib/realtime/public";
import type { SerializedMessage } from "@/lib/realtime/types";
import type { ImageGate } from "@/server/services/image-review";

export function useWidgetFileUpload({
  token,
  config,
  availability,
  conversationIdRef,
  setConversation,
  setMessages,
  scrollToLatest,
  imageGate,
  setImageGate,
  refreshImageGate,
  t,
}: {
  token: string | null;
  config: SiteConfig | null;
  availability: { online: boolean };
  conversationIdRef: { current: string | null };
  setConversation: Dispatch<SetStateAction<VisitorConversation | null>>;
  setMessages: Dispatch<SetStateAction<SerializedMessage[]>>;
  scrollToLatest: () => void;
  imageGate: ImageGate;
  setImageGate: Dispatch<SetStateAction<ImageGate>>;
  refreshImageGate: () => Promise<void>;
  t: ReturnType<typeof useT>;
}) {
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);

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

  return { uploading, uploadFile, recoverImage, handlePaste };
}
