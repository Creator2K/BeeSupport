"use client";

import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useT } from "@/components/locale-provider";
import { formatBytes } from "@/lib/format";
import type { SerializedAttachment } from "@/lib/realtime/types";
import { ImageAttachment } from "@/components/image-attachment";
import { ImageApproval } from "./image-approval";

/** Browser image/link requests cannot attach the visitor's localStorage bearer token. */
export function AttachmentView({
  attachment,
  visitorToken,
  allowImageApproval = false,
}: {
  attachment: SerializedAttachment;
  visitorToken?: string | null;
  allowImageApproval?: boolean;
}) {
  return attachment.isImage ? (
    <div className="space-y-2">
      <ImageAttachment attachment={attachment} visitorToken={visitorToken} />
      {allowImageApproval && attachment.imageReviewState === "PENDING" && (
        <ImageApproval attachmentId={attachment.id} />
      )}
    </div>
  ) : (
    <FileAttachmentView attachment={attachment} visitorToken={visitorToken} />
  );
}

function FileAttachmentView({
  attachment,
  visitorToken,
}: {
  attachment: SerializedAttachment;
  visitorToken?: string | null;
}) {
  const t = useT();
  const [downloading, setDownloading] = useState(false);
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      aria-busy={downloading}
      className="block overflow-hidden rounded-lg border border-current/15 p-1"
      onClick={
        visitorToken
          ? (event) => {
              event.preventDefault();
              if (downloading) return;
              setDownloading(true);
              void (async () => {
                const response = await fetch(attachment.url, {
                  headers: { authorization: `Bearer ${visitorToken}` },
                });
                if (!response.ok) throw new Error("Attachment unavailable");
                const url = URL.createObjectURL(await response.blob());
                const link = document.createElement("a");
                link.href = url;
                link.download = attachment.filename;
                document.body.appendChild(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              })()
                .catch(() => toast.error(t("common.downloadFailed")))
                .finally(() => setDownloading(false));
            }
          : undefined
      }
    >
      <span className="flex items-center gap-2 px-1 py-1 text-xs">
        {downloading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <FileText className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{attachment.filename}</span>
        <span className="shrink-0 opacity-70">
          {formatBytes(attachment.size)}
        </span>
      </span>
    </a>
  );
}
