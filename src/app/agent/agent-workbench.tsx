"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { toast } from "sonner";

import {
  ConversationList,
} from "@/components/agent/conversation-list";
import { ConversationHeader } from "@/components/agent/conversation-header";
import { VisitorPanel } from "@/components/agent/visitor-panel";
import { WorkbenchComposer } from "@/components/agent/workbench-composer";
import { WorkbenchDialogs } from "@/components/agent/workbench-dialogs";
import { WorkbenchHeader } from "@/components/agent/workbench-header";
import { WorkbenchMessageThread } from "@/components/agent/workbench-message-thread";
import type { WorkbenchMe } from "@/components/agent/workbench-types";
import { useT } from "@/components/locale-provider";
import { clearAccountDrafts } from "@/lib/chat-drafts";
import type { AgentPreferences } from "@/lib/preferences";
import type { SerializedConversation } from "@/lib/realtime/types";
import { useSocket } from "@/lib/realtime/use-socket";
import { cn } from "@/lib/utils";
import { useChatDrafts } from "@/lib/use-chat-drafts";
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

  const { prefs, updatePreferences, alertUser, toggleMute } =
    useWorkbenchPreferences(initialPreferences);
  const {
    conversations,
    filters,
    setFilters,
    pageNumber,
    setPageNumber,
    totalConversations,
    counts,
    activeId,
    setActiveId,
    activeIdRef,
    setMessages,
    activeMessages,
    activeConversation,
    loadingMessages,
    loadingList,
    loadingOlder,
    hasOlderMessages,
    typingConversationId,
    refreshList,
    upsertConversation,
    appendMessage,
    loadMessages,
    loadOlderMessages,
    scrollRef,
    onScroll,
    scrollToLatest,
    newMessagesBelow,
  } = useWorkbenchConversations({
    initialConversations,
    initialConversationId,
    socket,
    connected,
    alertUser,
    onOpenConversation: openMobileConversation,
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

  const {
    transferOpen,
    setTransferOpen,
    targetsLoading,
    targetsError,
    actionPending,
    targets,
    closeConfirmOpen,
    setCloseConfirmOpen,
    statusPending,
    runAction,
    openTransfer,
    transferTo,
    changeStatus,
  } = useWorkbenchActions({
    activeId,
    upsertConversation,
    agentStatus,
    setAgentStatus,
  });

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

  const {
    aiSuggestion,
    aiTrace,
    aiLoading,
    aiModelOptions,
    activeAiModel,
    generateSuggestion,
    applySuggestion,
    clearSuggestion,
  } = useWorkbenchAi({
    activeId,
    activeIdRef,
    ai,
    preferredModel: prefs.preferredModel,
  });

  const {
    sending,
    uploading,
    sendMessage,
    uploadFile,
    handlePaste,
    noteTypingActivity,
  } = useWorkbenchMessaging({
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
    <div className="flex h-dvh flex-col">
      <WorkbenchHeader
        me={me}
        connected={connected}
        loadingList={loadingList}
        preferences={prefs}
        agentStatus={agentStatus}
        statusPending={statusPending}
        adminPath={adminPath}
        onRefresh={() => void refreshList()}
        onToggleMute={toggleMute}
        onPreferencesChange={updatePreferences}
        onChangeStatus={(status) => void changeStatus(status)}
        onLogout={() => void handleLogout()}
      />

      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            "min-h-0 shrink-0",
            mobileChatOpen ? "hidden sm:flex" : "flex",
          )}
        >
          <ConversationList
            conversations={conversations}
            activeId={activeId}
            onSelect={selectConversation}
            filters={filters}
            onFiltersChange={setFilters}
            counts={counts}
            meId={me.id}
            sites={sites}
            loading={loadingList}
            page={pageNumber}
            total={totalConversations}
            onPageChange={setPageNumber}
          />
        </div>

        <main
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col",
            mobileChatOpen ? "flex" : "hidden sm:flex",
          )}
        >
          {!activeConversation ? (
            <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-sm">
              <MessagesSquare className="size-6" />
              {t("workbench.noSelection")}
            </div>
          ) : (
            <>
              <ConversationHeader
                conversation={activeConversation}
                typingConversationId={typingConversationId}
                actionPending={actionPending}
                targetsLoading={targetsLoading}
                onBack={() => setMobileChatOpen(false)}
                onClaim={() => void runAction("claim")}
                onTransfer={() => void openTransfer()}
                onReopen={() => void runAction("reopen")}
                onRequestClose={() => setCloseConfirmOpen(true)}
              />

              <WorkbenchMessageThread
                conversation={activeConversation}
                messages={activeMessages}
                loading={loadingMessages}
                hasOlder={Boolean(activeId && hasOlderMessages[activeId])}
                loadingOlder={loadingOlder}
                locale={locale}
                scrollRef={scrollRef}
                onScroll={onScroll}
                onLoadOlder={() => void loadOlderMessages()}
              />

              <WorkbenchComposer
                draft={draft}
                draftsReady={draftsReady}
                composerRef={composerRef}
                sending={sending}
                uploading={uploading}
                aiLoading={aiLoading}
                aiReady={ai.ready}
                aiModelOptions={aiModelOptions}
                activeAiModel={activeAiModel}
                aiSuggestion={aiSuggestion}
                aiTrace={aiTrace}
                newMessagesBelow={newMessagesBelow}
                cannedOpen={canned.open}
                cannedQuery={canned.query}
                cannedCategory={canned.category}
                cannedCategories={canned.categories}
                cannedLoading={canned.loading}
                cannedError={canned.error}
                cannedItems={canned.items}
                cannedInserting={canned.inserting}
                cannedHasMore={canned.hasMore}
                onDraftChange={setDraft}
                onTypingActivity={noteTypingActivity}
                onScrollToLatest={scrollToLatest}
                onUseSuggestion={() =>
                  applySuggestion((text) =>
                    setDraft((previous) =>
                      previous ? `${previous}\n${text}` : text,
                    ),
                  )
                }
                onDismissSuggestion={clearSuggestion}
                onModelChange={(value) =>
                  updatePreferences({ preferredModel: value })
                }
                onGenerateSuggestion={() => void generateSuggestion()}
                onCannedOpenChange={canned.setOpen}
                onCannedQueryChange={canned.setQuery}
                onCannedCategoryChange={canned.setCategory}
                onInsertCanned={canned.insert}
                onUploadFile={uploadFile}
                onSend={() => void sendMessage()}
                onPaste={(event) => void handlePaste(event)}
              />
            </>
          )}
        </main>

        {activeConversation ? (
          <VisitorPanel
            key={activeConversation.id}
            conversation={activeConversation}
            onUpdated={upsertConversation}
            onOpenConversation={selectConversation}
            profileHref={
              me.role !== "AGENT"
                ? `${adminPath}/visitors/${activeConversation.visitor.id}`
                : undefined
            }
          />
        ) : null}
      </div>

      <WorkbenchDialogs
        transferOpen={transferOpen}
        onTransferOpenChange={setTransferOpen}
        targetsLoading={targetsLoading}
        targetsError={targetsError}
        targets={targets}
        actionPending={actionPending}
        onRetryTargets={() => void openTransfer()}
        onTransfer={(targetId) => void transferTo(targetId)}
        closeConfirmOpen={closeConfirmOpen}
        onCloseConfirmOpenChange={setCloseConfirmOpen}
        onConfirmClose={() => {
          void runAction("close").then((ok) => {
            if (ok) setCloseConfirmOpen(false);
          });
        }}
      />
    </div>
  );
}
