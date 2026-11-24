"use client";

import type { RefObject } from "react";
import { MessagesSquare } from "lucide-react";

import { ConversationList } from "@/components/agent/conversation-list";
import { ConversationHeader } from "@/components/agent/conversation-header";
import { VisitorPanel } from "@/components/agent/visitor-panel";
import { WorkbenchComposer } from "@/components/agent/workbench-composer";
import { WorkbenchDialogs } from "@/components/agent/workbench-dialogs";
import { WorkbenchHeader } from "@/components/agent/workbench-header";
import { WorkbenchMessageThread } from "@/components/agent/workbench-message-thread";
import type { WorkbenchMe } from "@/components/agent/workbench-types";
import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";
import type { useWorkbenchActions } from "./use-workbench-actions";
import type { useWorkbenchAi } from "./use-workbench-ai";
import type { useWorkbenchCanned } from "./use-workbench-canned";
import type { useWorkbenchConversations } from "./use-workbench-conversations";
import type { useWorkbenchMessaging } from "./use-workbench-messaging";
import type { useWorkbenchPreferences } from "./use-workbench-preferences";

type AgentWorkbenchViewProps = {
  me: WorkbenchMe;
  locale: string;
  sites: { id: string; name: string }[];
  ai: { ready: boolean; models: string[]; defaultModel: string | null };
  adminPath: string;
  connected: boolean;
  mobileChatOpen: boolean;
  setMobileChatOpen: (open: boolean) => void;
  agentStatus: WorkbenchMe["status"];
  conversationState: ReturnType<typeof useWorkbenchConversations>;
  actionState: ReturnType<typeof useWorkbenchActions>;
  cannedState: ReturnType<typeof useWorkbenchCanned>;
  aiState: ReturnType<typeof useWorkbenchAi>;
  messagingState: ReturnType<typeof useWorkbenchMessaging>;
  preferenceState: ReturnType<typeof useWorkbenchPreferences>;
  draft: string;
  draftsReady: boolean;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  setDraft: (value: string | ((previous: string) => string)) => void;
  selectConversation: (id: string) => void;
  onLogout: () => void;
};

export function AgentWorkbenchView({
  me,
  locale,
  sites,
  ai,
  adminPath,
  connected,
  mobileChatOpen,
  setMobileChatOpen,
  agentStatus,
  conversationState,
  actionState,
  cannedState,
  aiState,
  messagingState,
  preferenceState,
  draft,
  draftsReady,
  composerRef,
  setDraft,
  selectConversation,
  onLogout,
}: AgentWorkbenchViewProps) {
  const t = useT();
  const {
    conversations,
    filters,
    setFilters,
    pageNumber,
    setPageNumber,
    totalConversations,
    counts,
    activeId,
    activeMessages,
    activeConversation,
    loadingMessages,
    loadingList,
    loadingOlder,
    hasOlderMessages,
    typingConversationId,
    refreshList,
    upsertConversation,
    loadOlderMessages,
    scrollRef,
    onScroll,
    scrollToLatest,
    newMessagesBelow,
  } = conversationState;

  return (
    <div className="flex h-dvh flex-col">
      <WorkbenchHeader
        me={me}
        connected={connected}
        loadingList={loadingList}
        preferences={preferenceState.prefs}
        agentStatus={agentStatus}
        statusPending={actionState.statusPending}
        adminPath={adminPath}
        onRefresh={() => void refreshList()}
        onToggleMute={preferenceState.toggleMute}
        onPreferencesChange={preferenceState.updatePreferences}
        onChangeStatus={(status) => void actionState.changeStatus(status)}
        onLogout={onLogout}
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
                actionPending={actionState.actionPending}
                targetsLoading={actionState.targetsLoading}
                onBack={() => setMobileChatOpen(false)}
                onClaim={() => void actionState.runAction("claim")}
                onTransfer={() => void actionState.openTransfer()}
                onReopen={() => void actionState.runAction("reopen")}
                onRequestClose={() => actionState.setCloseConfirmOpen(true)}
              />

              <WorkbenchMessageThread
                userId={me.id}
                onDelete={conversationState.deleteMessage}
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
                sending={messagingState.sending}
                uploading={messagingState.uploading}
                aiLoading={aiState.aiLoading}
                aiReady={ai.ready}
                aiModelOptions={aiState.aiModelOptions}
                activeAiModel={aiState.activeAiModel}
                aiSuggestion={aiState.aiSuggestion}
                aiTrace={aiState.aiTrace}
                newMessagesBelow={newMessagesBelow}
                cannedOpen={cannedState.open}
                cannedQuery={cannedState.query}
                cannedCategory={cannedState.category}
                cannedCategories={cannedState.categories}
                cannedLoading={cannedState.loading}
                cannedError={cannedState.error}
                cannedItems={cannedState.items}
                cannedInserting={cannedState.inserting}
                cannedHasMore={cannedState.hasMore}
                onDraftChange={setDraft}
                onTypingActivity={messagingState.noteTypingActivity}
                onScrollToLatest={scrollToLatest}
                onUseSuggestion={() =>
                  aiState.applySuggestion((text) =>
                    setDraft((previous) =>
                      previous ? `${previous}\n${text}` : text,
                    ),
                  )
                }
                onDismissSuggestion={aiState.clearSuggestion}
                onModelChange={(value) =>
                  preferenceState.updatePreferences({ preferredModel: value })
                }
                onGenerateSuggestion={() => void aiState.generateSuggestion()}
                onCannedOpenChange={cannedState.setOpen}
                onCannedQueryChange={cannedState.setQuery}
                onCannedCategoryChange={cannedState.setCategory}
                onInsertCanned={cannedState.insert}
                onUploadFile={messagingState.uploadFile}
                onSend={() => void messagingState.sendMessage()}
                onPaste={(event) => void messagingState.handlePaste(event)}
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
        transferOpen={actionState.transferOpen}
        onTransferOpenChange={actionState.setTransferOpen}
        targetsLoading={actionState.targetsLoading}
        targetsError={actionState.targetsError}
        targets={actionState.targets}
        actionPending={actionState.actionPending}
        onRetryTargets={() => void actionState.openTransfer()}
        onTransfer={(targetId) => void actionState.transferTo(targetId)}
        closeConfirmOpen={actionState.closeConfirmOpen}
        onCloseConfirmOpenChange={actionState.setCloseConfirmOpen}
        onConfirmClose={() => {
          void actionState.runAction("close").then((ok) => {
            if (ok) actionState.setCloseConfirmOpen(false);
          });
        }}
      />
    </div>
  );
}
