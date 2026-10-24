"use client";

import { WidgetComposer } from "@/components/widget/widget-composer";
import { WidgetMessageList } from "@/components/widget/widget-message-list";
import type { WidgetChatController } from "./use-widget-chat";

export function WidgetChatConversation({
  chat,
}: {
  chat: WidgetChatController;
}) {
  const {
    mode,
    config,
    conversation,
    messages,
    token,
    agentTyping,
    hasOlder,
    loadingOlder,
    showOfflineNotice,
    ratingValue,
    ratingComment,
    ratingSubmitted,
    scrollRef,
    onScroll,
    loadOlder,
    setRatingValue,
    setRatingComment,
    submitRating,
    startNewConversation,
    composerRef,
    draft,
    setDraft,
    sending,
    uploading,
    newMessagesBelow,
    imageGate,
    socket,
    sendMessage,
    handlePaste,
    uploadFile,
    recoverImage,
    scrollToLatest,
  } = chat;

  return (
    <>
      {mode === "chat" ? (
        <>
          <WidgetMessageList
            config={config}
            conversation={conversation}
            messages={messages}
            token={token}
            agentTyping={agentTyping}
            hasOlder={hasOlder}
            loadingOlder={loadingOlder}
            showOfflineNotice={showOfflineNotice}
            ratingValue={ratingValue}
            ratingComment={ratingComment}
            ratingSubmitted={ratingSubmitted}
            scrollRef={scrollRef}
            onScroll={onScroll}
            onLoadOlder={() => void loadOlder()}
            onRatingValueChange={setRatingValue}
            onRatingCommentChange={setRatingComment}
            onSubmitRating={() => void submitRating()}
            onStartNew={startNewConversation}
          />

          <WidgetComposer
            config={config}
            composerRef={composerRef}
            draft={draft}
            sending={sending}
            uploading={uploading}
            newMessagesBelow={newMessagesBelow}
            imageGate={imageGate}
            onDraftChange={setDraft}
            onTyping={() => {
              if (socket && conversation?.id) {
                socket.emit("typing", {
                  conversationId: conversation.id,
                  isTyping: true,
                });
              }
            }}
            onSend={() => void sendMessage()}
            onPaste={(event) => void handlePaste(event)}
            onUpload={(file) => void uploadFile(file)}
            onRecoverImage={(cancel) => void recoverImage(cancel)}
            onScrollToLatest={scrollToLatest}
          />
        </>
      ) : null}
    </>
  );
}
