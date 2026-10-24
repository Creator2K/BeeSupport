"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import type { WorkbenchMe } from "@/components/agent/workbench-types";
import { useT } from "@/components/locale-provider";
import { clearAccountDrafts } from "@/lib/chat-drafts";
import type { AgentPreferences } from "@/lib/preferences";
import type { SerializedConversation } from "@/lib/realtime/types";
import { useSocket } from "@/lib/realtime/use-socket";
import { useChatDrafts } from "@/lib/use-chat-drafts";
import { AgentWorkbenchView } from "./agent-workbench-view";
import { useWorkbenchActions } from "./use-workbench-actions";
import { useWorkbenchAi } from "./use-workbench-ai";
import { useWorkbenchCanned } from "./use-workbench-canned";
import { useWorkbenchConversations } from "./use-workbench-conversations";
import { useWorkbenchMessaging } from "./use-workbench-messaging";
import { useWorkbenchPreferences } from "./use-workbench-preferences";
export type { WorkbenchMe } from "@/components/agent/workbench-types";

export function AgentWorkbench({
  me,
  locale,
  initialConversations,
  sites,
  initialConversationId,
  initialPreferences,
  ai,
  adminPath,
}: {
  me: WorkbenchMe;
  locale: string;
  initialConversations: SerializedConversation[];
  sites: { id: string; name: string }[];
  initialConversationId: string | null;
  /** 个人偏好（提示音音色、音量、桌面通知），存服务端 */
  initialPreferences: AgentPreferences;
  /** AI 助手可用状态与模型清单 */
  ai: { ready: boolean; models: string[]; defaultModel: string | null };
  /** 后台随机入口路径，管理员账号可以从工作台跳过去 */
  adminPath: string;
}) {
  const t = useT();
  const router = useRouter();
  const { socket, connected } = useSocket();
  const [mobileChatOpen, setMobileChatOpen] = useState(
    Boolean(initialConversationId),
  );
  const [agentStatus, setAgentStatus] = useState(me.status);
  const openMobileConversation = useCallback(() => setMobileChatOpen(true), []);

  const preferenceState = useWorkbenchPreferences(initialPreferences);
  const { prefs, alertUser } = preferenceState;

  const conversationState = useWorkbenchConversations({
    initialConversations,
    initialConversationId,
    socket,
    connected,
    alertUser,
    onOpenConversation: openMobileConversation,
  });
  const {
    activeId,
    setActiveId,
    activeIdRef,
    setMessages,
    activeConversation,
    upsertConversation,
    appendMessage,
    loadMessages,
    scrollToLatest,
  } = conversationState;

  const actionState = useWorkbenchActions({
    activeId,
    upsertConversation,
    agentStatus,
    setAgentStatus,
  });

useEffect(() => {
    if (!socket) return;
    const reviewed = (event: { attachmentId: string; state: string }) => {
      setMessages((previous) =>
        Object.fromEntries(
          Object.entries(previous).map(([id, items]) => [
            id,
            items.map((message) => ({
              ...message,
              attachments: message.attachments.map((attachment) =>
                attachment.id === event.attachmentId
                  ? { ...attachment, imageReviewState: event.state }
                  : attachment,
              ),
            })),
          ]),
        ),
      );
    };
    const revoked = () => window.location.assign("/login");
    const presence = (payload: {
      userId: string;
      status: WorkbenchMe["status"];
    }) => {
      if (payload.userId === me.id) setAgentStatus(payload.status);
    };
    socket.on("image:reviewed", reviewed);
    socket.on("session:revoked", revoked);
    socket.on("presence:agent", presence);
    return () => {
      socket.off("image:reviewed", reviewed);
      socket.off("session:revoked", revoked);
      socket.off("presence:agent", presence);
    };
  }, [socket, me.id, setMessages]);

const [drafts, setDrafts, draftsReady] = useChatDrafts(me.id);
  const draft = activeId ? (drafts[activeId] ?? "") : "";
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const composerRef = useRef<HTMLTextAreaElement>(null);

  function setDraft(value: string | ((previous: string) => string)) {
    if (!activeId) return;
    const id = activeId;
    setDrafts((previous) => ({
      ...previous,
      [id]: typeof value === "function" ? value(previous[id] ?? "") : value,
    }));
  }

  const canned = useWorkbenchCanned({
    activeConversation,
    activeIdRef,
    draftsRef,
    onDraftChange: (conversationId, value) =>
      setDrafts((previous) => ({ ...previous, [conversationId]: value })),
    onFocus: () => composerRef.current?.focus(),
  });

  const aiState = useWorkbenchAi({
    activeId,
    activeIdRef,
    ai,
    preferredModel: prefs.preferredModel,
  });

  const { clearSuggestion } = aiState;

  const messagingState = useWorkbenchMessaging({
    activeId,
    activeIdRef,
    activeConversation,
    me,
    draft,
    setDraft,
    setMessages,
    appendMessage,
    loadMessages,
    scrollToLatest,
    socket,
  });

function selectConversation(id: string) {
    canned.reset();
    setActiveId(id);
    setMobileChatOpen(true);
    clearSuggestion();
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `/agent?c=${id}`);
    }
  }

  async function handleLogout() {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout failed");
      clearAccountDrafts(me.id);
      router.replace("/login");
      router.refresh();
    } catch {
      toast.error(t("common.operationFailed"));
    }
  }

  return (
    <AgentWorkbenchView
      me={me}
      locale={locale}
      sites={sites}
      ai={ai}
      adminPath={adminPath}
      connected={connected}
      mobileChatOpen={mobileChatOpen}
      setMobileChatOpen={setMobileChatOpen}
      agentStatus={agentStatus}
      conversationState={conversationState}
      actionState={actionState}
      cannedState={canned}
      aiState={aiState}
      messagingState={messagingState}
      preferenceState={preferenceState}
      draft={draft}
      draftsReady={draftsReady}
      composerRef={composerRef}
      setDraft={setDraft}
      selectConversation={selectConversation}
      onLogout={handleLogout}
    />
  );
}
