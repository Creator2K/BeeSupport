"use client";

import { useRef, useState } from "react";
import { Smile } from "lucide-react";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const EMOJIS = [
  "😀",
  "😃",
  "😊",
  "🥰",
  "😍",
  "😂",
  "🤣",
  "😉",
  "😎",
  "🤔",
  "😅",
  "🥲",
  "😭",
  "😮",
  "😔",
  "😤",
  "👍",
  "👎",
  "👏",
  "🙌",
  "🙏",
  "🤝",
  "👋",
  "👌",
  "❤️",
  "💛",
  "💚",
  "💙",
  "🎉",
  "🎁",
  "🌹",
  "✨",
  "🔥",
  "💯",
  "✅",
  "❓",
  "☕",
  "🍀",
  "🚀",
  "🐝",
];

/** Remember the insertion point before focus moves into the popover. */
export function EmojiPicker({
  textareaRef,
  value,
  onChange,
  disabled = false,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const selection = useRef({ start: value.length, end: value.length });
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          const input = textareaRef.current;
          selection.current = {
            start: input?.selectionStart ?? value.length,
            end: input?.selectionEnd ?? value.length,
          };
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          disabled={disabled}
          aria-label={t("chat.emoji")}
          title={t("chat.emoji")}
        >
          <Smile className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 max-w-[calc(100vw-1rem)] p-3"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <p className="mb-2 text-xs font-medium">{t("chat.emoji")}</p>
        <div className="grid grid-cols-8 gap-1">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`${t("chat.insertEmoji")} ${emoji}`}
              className="flex size-7 items-center justify-center rounded text-xl hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => {
                const { start, end } = selection.current;
                const next = value.slice(0, start) + emoji + value.slice(end);
                if (next.length > 5000) return;
                onChange(next);
                setOpen(false);
                requestAnimationFrame(() => {
                  textareaRef.current?.focus();
                  textareaRef.current?.setSelectionRange(
                    start + emoji.length,
                    start + emoji.length,
                  );
                });
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
