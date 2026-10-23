"use client";

import { useState } from "react";
import {
  Bot,
  Check,
  CheckCheck,
  ChevronDown,
  Paperclip,
  Wrench,
} from "lucide-react";

import { formatTime } from "@/lib/format";
import { AttachmentView } from "./attachment-view";
import type { SerializedMessage } from "@/lib/realtime/types";
import { cn } from "@/lib/utils";

type AiTraceMeta = {
  model?: string;
  rounds?: number;
  tools?: { name: string; summary: string; ok: boolean; ms: number }[];
  knowledge?: { title: string; score: number; via: string }[];
  usage?: { promptTokens: number; completionTokens: number } | null;
};

export function MessageBubble({
  message,
  mine,
  locale,
  labels,
  receiptAt,
  showAiTrace = false,
  visitorToken,
  allowImageApproval = false,
}: {
  message: SerializedMessage;
  /** 是否是自己发出的消息（决定左右对齐） */
  mine: boolean;
  locale?: string;
  labels: {
    read: string;
    delivered: string;
    system: string;
    note: string;
    ai: string;
    tools: string;
    knowledge: string;
  };
  /** 自己发出的消息是否已被对方读取（客服端看 readByVisitorAt，访客端看 readByAgentAt） */
  receiptAt?: string | null;
  /** 只在客服工作台展示 AI 的工具调用轨迹 */
  showAiTrace?: boolean;
  visitorToken?: string | null;
  allowImageApproval?: boolean;
}) {
  const [traceOpen, setTraceOpen] = useState(false);

  if (message.sender === "SYSTEM" || message.type === "SYSTEM") {
    return (
      <div className="flex justify-center py-1">
        <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-[11px]">
          {message.body}
        </span>
      </div>
    );
  }

  const isNote = message.type === "NOTE";
  const isAi = message.sender === "AI";
  const aiMeta =
    isAi && showAiTrace
      ? ((message.meta?.ai ?? null) as AiTraceMeta | null)
      : null;
  const hasTrace = Boolean(
    aiMeta &&
    ((aiMeta.tools?.length ?? 0) > 0 || (aiMeta.knowledge?.length ?? 0) > 0),
  );

  return (
    <div
      className={cn(
        "animate-rise flex",
        mine && !isNote ? "justify-end" : "justify-start",
      )}
    >
      <div className={cn("max-w-[82%] space-y-1 sm:max-w-[70%]")}>
        <div
          className={cn(
            "rounded-xl px-3 py-2 text-sm shadow-xs",
            isNote
              ? "border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
              : isAi
                ? "border border-foreground/10 bg-foreground/[0.04] text-foreground"
                : mine
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground",
          )}
        >
          {isNote ? (
            <div className="mb-1 text-[10px] font-medium tracking-wide uppercase opacity-70">
              {labels.note}
            </div>
          ) : null}

          {isAi && !isNote ? (
            <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-[10px] font-medium tracking-wide uppercase">
              <Bot className="size-3" />
              {labels.ai}
              {message.authorName ? (
                <span className="normal-case opacity-70">
                  · {message.authorName}
                </span>
              ) : null}
            </div>
          ) : null}

          {message.body ? (
            <div className="chat-text leading-relaxed">{message.body}</div>
          ) : null}

          {hasTrace && aiMeta ? (
            <div className="mt-2 border-t border-current/10 pt-1.5">
              <button
                type="button"
                onClick={() => setTraceOpen((value) => !value)}
                className="text-muted-foreground inline-flex items-center gap-1 text-[10px]"
              >
                <Wrench className="size-2.5" />
                {aiMeta.model ?? "AI"}
                {aiMeta.tools && aiMeta.tools.length > 0 ? (
                  <span>
                    · {labels.tools} {aiMeta.tools.length}
                  </span>
                ) : null}
                {aiMeta.knowledge && aiMeta.knowledge.length > 0 ? (
                  <span>
                    · {labels.knowledge} {aiMeta.knowledge.length}
                  </span>
                ) : null}
                <ChevronDown
                  className={cn(
                    "size-2.5 transition-transform",
                    traceOpen && "rotate-180",
                  )}
                />
              </button>

              {traceOpen ? (
                <ul className="text-muted-foreground mt-1 space-y-0.5 text-[10px] leading-relaxed">
                  {aiMeta.tools?.map((tool, index) => (
                    <li key={`${tool.name}-${index}`} className="flex gap-1">
                      <span className={tool.ok ? "" : "text-amber-600"}>
                        tool
                      </span>
                      <span className="min-w-0 flex-1 break-words">
                        {tool.name} — {tool.summary} ({tool.ms}ms)
                      </span>
                    </li>
                  ))}
                  {aiMeta.knowledge?.map((item, index) => (
                    <li key={`${item.title}-${index}`} className="flex gap-1">
                      <span>kb</span>
                      <span className="min-w-0 flex-1 break-words">
                        {item.title} · {item.score} · {item.via}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {message.attachments.length > 0 ? (
            <div className={cn("space-y-2", message.body && "mt-2")}>
              {message.attachments.map((attachment) => (
                <AttachmentView
                  key={attachment.id}
                  attachment={attachment}
                  visitorToken={visitorToken}
                  allowImageApproval={
                    allowImageApproval && message.sender === "VISITOR"
                  }
                />
              ))}
            </div>
          ) : null}
        </div>

        <div
          className={cn(
            "text-muted-foreground flex items-center gap-1.5 text-[10px]",
            mine && !isNote ? "justify-end" : "justify-start",
          )}
        >
          <span>{formatTime(message.createdAt, locale)}</span>
          {mine && !isNote ? (
            receiptAt ? (
              <span className="inline-flex items-center gap-0.5">
                <CheckCheck className="size-3" />
                {labels.read}
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5">
                <Check className="size-3" />
                {labels.delivered}
              </span>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function AttachmentHint({
  label,
  count,
}: {
  label: string;
  count: number;
}) {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
      <Paperclip className="size-3" />
      {label} {count}
    </span>
  );
}
