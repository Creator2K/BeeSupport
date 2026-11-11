"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useT } from "@/components/locale-provider";
import type {
  SerializedConversation,
  VisitorConversationSummary,
} from "@/lib/realtime/types";
import { VisitorConversationFields } from "./visitor-conversation-fields";
import { VisitorHistorySection } from "./visitor-history-section";
import { VisitorProfileSection } from "./visitor-profile-section";

export function VisitorPanel({
  conversation,
  onUpdated,
  onOpenConversation,
  profileHref,
}: {
  conversation: SerializedConversation;
  onUpdated: (conversation: SerializedConversation) => void;
  onOpenConversation?: (conversationId: string) => void;
  profileHref?: string;
}) {
  const t = useT();
  const [tags, setTags] = useState<string[]>(conversation.tags);
  const [tagDraft, setTagDraft] = useState("");
  const [note, setNote] = useState(conversation.note ?? "");
  const [subject, setSubject] = useState(conversation.subject ?? "");
  const [priority, setPriority] = useState(String(conversation.priority));
  const [pending, setPending] = useState(false);

  const [history, setHistory] = useState<VisitorConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const serverDraft = useRef({
    note: conversation.note ?? "",
    subject: conversation.subject ?? "",
  });
  const tagsKey = JSON.stringify(conversation.tags);

  useEffect(() => {
    setTags(JSON.parse(tagsKey) as string[]);
  }, [tagsKey]);
  useEffect(() => {
    const previous = serverDraft.current;
    const next = {
      note: conversation.note ?? "",
      subject: conversation.subject ?? "",
    };
    setNote((draft) => (draft === previous.note ? next.note : draft));
    setSubject((draft) => (draft === previous.subject ? next.subject : draft));
    serverDraft.current = next;
  }, [conversation.note, conversation.subject]);
  useEffect(() => {
    setPriority(String(conversation.priority));
  }, [conversation.priority]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await fetch(
        `/api/agent/conversations/${conversation.id}/history`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const data = (await response.json()) as {
        conversations?: VisitorConversationSummary[];
      };
      setHistory(data.conversations ?? []);
    } catch {
      toast.error(t("common.operationFailed"));
    } finally {
      setHistoryLoading(false);
    }
  }, [conversation.id, t]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function save(patch: {
    tags?: string[];
    note?: string;
    priority?: number;
    subject?: string;
  }): Promise<boolean> {
    setPending(true);
    try {
      const response = await fetch(
        `/api/agent/conversations/${conversation.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const data = (await response.json()) as {
        conversation?: SerializedConversation;
        error?: string;
      };
      if (!response.ok || !data.conversation) {
        toast.error(data.error ?? t("common.operationFailed"));
        return false;
      }
      onUpdated(data.conversation);
      return true;
    } catch {
      toast.error(t("common.operationFailed"));
      return false;
    } finally {
      setPending(false);
    }
  }

  async function addTag() {
    const value = tagDraft.trim();
    if (!value || tags.includes(value) || tags.length >= 12 || pending) return;
    const next = [...tags, value];
    if (await save({ tags: next }))
      setTagDraft((draft) => (draft.trim() === value ? "" : draft));
  }

  function removeTag(value: string) {
    if (pending) return;
    const next = tags.filter((tag) => tag !== value);
    void save({ tags: next });
  }

  return (
    <aside className="bg-card hidden w-72 shrink-0 flex-col overflow-y-auto border-l lg:flex">
      <div className="flex items-center justify-between border-b px-3 py-2.5">
        <h2 className="text-sm font-medium">{t("workbench.visitorInfo")}</h2>
      </div>

      <div className="space-y-3 p-3">
        <VisitorProfileSection
          conversation={conversation}
          historyCount={history.length}
          profileHref={profileHref}
        />

        <VisitorHistorySection
          history={history}
          loading={historyLoading}
          onRefresh={() => void loadHistory()}
          onOpenConversation={onOpenConversation}
        />

        <VisitorConversationFields
          subject={subject}
          tags={tags}
          tagDraft={tagDraft}
          note={note}
          priority={priority}
          rating={conversation.rating}
          ratingComment={conversation.ratingComment}
          pending={pending}
          onSubjectChange={setSubject}
          onSaveSubject={() => void save({ subject })}
          onTagDraftChange={setTagDraft}
          onAddTag={() => void addTag()}
          onRemoveTag={removeTag}
          onPriorityChange={(value) => void save({ priority: Number(value) })}
          onNoteChange={setNote}
          onSaveNote={() => {
            void save({ note }).then((ok) => {
              if (ok) toast.success(t("workbench.noteSaved"));
            });
          }}
        />
      </div>
    </aside>
  );
}
