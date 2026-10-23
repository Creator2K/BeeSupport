"use client";

import { Loader2, Paperclip, Send } from "lucide-react";

import { EmojiPicker } from "@/components/emoji-picker";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ImageGate } from "@/server/services/image-review";
import { cn } from "@/lib/utils";

import type { SiteConfig } from "./widget-types";

type WidgetComposerProps = {
  config: SiteConfig | null;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  draft: string;
  sending: boolean;
  uploading: boolean;
  newMessagesBelow: boolean;
  imageGate: ImageGate;
  onDraftChange: (value: string) => void;
  onTyping: () => void;
  onSend: () => void;
  onPaste: React.ClipboardEventHandler<HTMLTextAreaElement>;
  onUpload: (file: File) => void;
  onRecoverImage: (cancel?: boolean) => void;
  onScrollToLatest: () => void;
};

export function WidgetComposer({
  config,
  composerRef,
  draft,
  sending,
  uploading,
  newMessagesBelow,
  imageGate,
  onDraftChange,
  onTyping,
  onSend,
  onPaste,
  onUpload,
  onRecoverImage,
  onScrollToLatest,
}: WidgetComposerProps) {
  const t = useT();

  return (
    <div className="pb-safe shrink-0 border-t px-3 py-2.5">
      {newMessagesBelow ? (
        <Button
          className="mb-2 w-full"
          variant="secondary"
          size="sm"
          onClick={onScrollToLatest}
        >
          {t("common.newMessages")}
        </Button>
      ) : null}
      {imageGate.enabled && (
        <div
          role="status"
          className="bg-muted/40 mb-2 rounded-lg border px-3 py-2 text-xs leading-5"
        >
          <p>
            {t(
              imageGate.pending
                ? imageGate.pending.sent
                  ? "images.waiting"
                  : "images.unsent"
                : "images.enabled",
            )}
          </p>
          {imageGate.pending && !imageGate.pending.sent && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={uploading}
                onClick={() => onRecoverImage()}
              >
                {t("images.retry")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={uploading}
                onClick={() => onRecoverImage(true)}
              >
                {t("images.cancel")}
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          ref={composerRef}
          value={draft}
          rows={1}
          placeholder={t("widget.messagePlaceholder")}
          className="max-h-32 min-h-9 flex-1 resize-none text-sm"
          onChange={(event) => {
            onDraftChange(event.target.value);
            onTyping();
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.nativeEvent.keyCode !== 229
            ) {
              event.preventDefault();
              onSend();
            }
          }}
          onPaste={onPaste}
        />

        {config?.emojiEnabled && (
          <EmojiPicker
            textareaRef={composerRef}
            value={draft}
            onChange={onDraftChange}
            disabled={sending}
          />
        )}

        {(config?.imagesEnabled || config?.filesEnabled) && (
          <label
            className={cn(
              "border-input focus-within:ring-ring inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md border focus-within:ring-2",
              uploading && "pointer-events-none opacity-50",
            )}
            title={t("widget.attach")}
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Paperclip className="size-4" />
            )}
            <input
              type="file"
              accept={config?.filesEnabled ? undefined : "image/*"}
              className="sr-only"
              disabled={uploading}
              aria-label={t("widget.attach")}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUpload(file);
                event.target.value = "";
              }}
            />
          </label>
        )}

        <Button
          size="icon"
          className="size-9 shrink-0"
          disabled={!draft.trim() || sending}
          onClick={onSend}
          title={t("widget.send")}
        >
          {sending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </Button>
      </div>

      <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center justify-between gap-x-2 text-[10px]">
        <span>{config?.imagesEnabled ? t("widget.pasteHint") : ""}</span>
        <span>{config?.footerText ?? t("widget.poweredBy")}</span>
      </div>
    </div>
  );
}
