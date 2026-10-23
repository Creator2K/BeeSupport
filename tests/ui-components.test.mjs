import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";

import { loadUiModule, renderUi } from "./ui-fixtures.mjs";

const { WorkbenchHeader } = loadUiModule(
  "src/components/agent/workbench-header.tsx",
);
const { ConversationHeader } = loadUiModule(
  "src/components/agent/conversation-header.tsx",
);
const { CannedReplyPicker } = loadUiModule(
  "src/components/agent/canned-reply-picker.tsx",
);
const { AiSuggestionPanel } = loadUiModule(
  "src/components/agent/ai-suggestion-panel.tsx",
);
const { WorkbenchDialogs } = loadUiModule(
  "src/components/agent/workbench-dialogs.tsx",
);
const { WidgetHeader } = loadUiModule("src/components/widget/widget-header.tsx");
const { WidgetIdentityForm } = loadUiModule(
  "src/components/widget/widget-identity-form.tsx",
);
const { WidgetComposer } = loadUiModule(
  "src/components/widget/widget-composer.tsx",
);
const { WidgetClosedCard } = loadUiModule(
  "src/components/widget/widget-closed-card.tsx",
);
const { AiConnectionTab } = loadUiModule(
  "src/app/admin/ai/ai-connection-tab.tsx",
);
const { AiPromptTab } = loadUiModule("src/app/admin/ai/ai-prompt-tab.tsx");
const { AiKnowledgeTab } = loadUiModule(
  "src/app/admin/ai/ai-knowledge-tab.tsx",
);

const noop = () => {};

test("agent workbench split components keep key actions and states", () => {
  const me = {
    id: "agent-1",
    name: "Agent One",
    email: "agent@example.test",
    role: "AGENT",
    status: "ONLINE",
  };
  const header = renderUi(WorkbenchHeader, {
    me,
    connected: true,
    loadingList: false,
    preferences: { soundPreset: "default" },
    agentStatus: "ONLINE",
    statusPending: false,
    adminPath: "/admin",
    onRefresh: noop,
    onToggleMute: noop,
    onPreferencesChange: noop,
    onChangeStatus: noop,
    onLogout: noop,
  });
  assert.match(header, /nav\.agentTitle/);
  assert.match(header, /workbench\.statusOnline/);
  assert.match(header, /common\.logout/);

  const conversation = {
    id: "conversation-1",
    siteId: "site-1",
    siteName: "Demo Site",
    status: "PENDING",
    visitor: {
      id: "visitor-1",
      name: "Visitor",
      email: "visitor@example.test",
      online: true,
      lastSeenAt: new Date().toISOString(),
    },
  };
  const conversationHeader = renderUi(ConversationHeader, {
    conversation,
    typingConversationId: null,
    actionPending: false,
    targetsLoading: false,
    onBack: noop,
    onClaim: noop,
    onTransfer: noop,
    onReopen: noop,
    onRequestClose: noop,
  });
  assert.match(conversationHeader, /Demo Site/);
  assert.match(conversationHeader, /workbench\.claim/);
  assert.match(conversationHeader, /workbench\.transfer/);

  const canned = renderUi(CannedReplyPicker, {
    open: true,
    onOpenChange: noop,
    query: "",
    onQueryChange: noop,
    category: "",
    onCategoryChange: noop,
    categories: ["Pricing"],
    loading: false,
    error: false,
    items: [
      {
        id: "c1",
        title: "Refund policy",
        content: "Refunds are available within 7 days.",
        shortcut: "refund",
        siteId: null,
        category: "Pricing",
        shared: true,
      },
    ],
    inserting: false,
    hasMore: false,
    onInsert: async () => {},
  });
  assert.match(canned, /workbench\.cannedSearch/);
  assert.match(canned, /Refund policy/);
  assert.match(canned, /\/refund/);

  const suggestion = renderUi(AiSuggestionPanel, {
    text: "Suggested answer",
    trace: {
      model: "model-a",
      tools: [{ name: "search_knowledge", summary: "searched", ok: true, ms: 2 }],
      knowledge: [{ title: "FAQ", score: 0.9, via: "keyword" }],
    },
    onUse: noop,
    onDismiss: noop,
  });
  assert.match(suggestion, /Suggested answer/);
  assert.match(suggestion, /search_knowledge/);
  assert.match(suggestion, /FAQ/);

  const dialogs = renderUi(WorkbenchDialogs, {
    transferOpen: true,
    onTransferOpenChange: noop,
    targetsLoading: false,
    targetsError: false,
    targets: [
      {
        id: "target-1",
        name: "Target Agent",
        email: "target@example.test",
        status: "ONLINE",
      },
    ],
    actionPending: false,
    onRetryTargets: noop,
    onTransfer: noop,
    closeConfirmOpen: true,
    onCloseConfirmOpenChange: noop,
    onConfirmClose: noop,
  });
  assert.match(dialogs, /Target Agent/);
  assert.match(dialogs, /target@example\.test/);
  assert.match(dialogs, /workbench\.closeConfirm/);
});

test("widget split components render identity, composer and rating controls", () => {
  const config = {
    title: "Demo Support",
    logoUrl: "",
    footerText: "Powered by Demo",
    imagesEnabled: true,
    filesEnabled: true,
    emojiEnabled: true,
    ratingEnabled: true,
    maxUploadMB: 20,
    name: "Demo",
    publicKey: "public-key",
    primaryColor: "#123456",
    position: "right",
    welcomeMessage: "Welcome",
    offlineMessage: "Leave a message",
    requireEmail: true,
  };

  const header = renderUi(WidgetHeader, {
    config,
    online: true,
    onClose: noop,
  });
  assert.match(header, /Demo Support/);
  assert.match(header, /widget\.siteOnline/);
  assert.match(header, /aria-label="widget\.close"/);

  const form = renderUi(WidgetIdentityForm, {
    config,
    online: true,
    email: "visitor@example.test",
    name: "Visitor",
    formError: "Form error",
    submitting: false,
    onEmailChange: noop,
    onNameChange: noop,
    onSubmit: noop,
  });
  assert.match(form, /id="visitor-email"/);
  assert.match(form, /id="visitor-name"/);
  assert.match(form, /widget\.startFormTitle/);
  assert.match(form, /Form error/);

  const composer = renderUi(WidgetComposer, {
    config,
    composerRef: React.createRef(),
    draft: "Hello",
    sending: false,
    uploading: false,
    newMessagesBelow: true,
    imageGate: { enabled: true, pending: null },
    onDraftChange: noop,
    onTyping: noop,
    onSend: noop,
    onPaste: noop,
    onUpload: noop,
    onRecoverImage: noop,
    onScrollToLatest: noop,
  });
  assert.match(composer, /widget\.messagePlaceholder/);
  assert.match(composer, /widget\.send/);
  assert.match(composer, /images\.enabled/);
  assert.match(composer, /common\.newMessages/);

  const rating = renderUi(WidgetClosedCard, {
    ratingEnabled: true,
    ratingSubmitted: false,
    existingRating: null,
    ratingValue: 4,
    ratingComment: "Good",
    onRatingValueChange: noop,
    onRatingCommentChange: noop,
    onSubmitRating: noop,
    onStartNew: noop,
  });
  assert.match(rating, /widget\.closedByAgent/);
  assert.match(rating, /widget\.rateHint/);
  assert.match(rating, /widget\.startNew/);
});

test("AI admin tabs render model, prompt and knowledge editor controls", () => {
  const form = {
    enabled: true,
    baseUrl: "https://api.example.test/v1",
    apiKey: "secret",
    model: "model-a",
    models: ["model-a"],
    assistantName: "Assistant",
    systemPrompt: "You are helpful.",
    autoReply: "off",
    temperature: 0.4,
    maxTokens: 800,
    topK: 4,
    historyLimit: 8,
    enableEmbeddings: false,
    embeddingModel: "embedding-a",
    enableTools: true,
    maxToolRounds: 4,
  };
  const connection = renderUi(AiConnectionTab, {
    form,
    modelOptions: ["model-a", "model-b"],
    loadingModels: false,
    testing: false,
    testPrompt: "Test prompt",
    testOutput: "Test output",
    indexStats: { entries: 2, chunks: 5, vectorized: 1 },
    reindexing: null,
    onUpdate: noop,
    onToggleModel: noop,
    onLoadModels: noop,
    onTest: noop,
    onReindex: noop,
    onTestPromptChange: noop,
  });
  assert.match(connection, /ai\.openaiCompat/);
  assert.match(connection, /ai\.modelsLabel/);
  assert.match(connection, /ai\.testPanelTitle/);
  assert.match(connection, /Test output/);

  const prompt = renderUi(AiPromptTab, { form, onUpdate: noop });
  assert.match(prompt, /id="ai-name"/);
  assert.match(prompt, /id="ai-prompt"/);
  assert.match(prompt, /ai\.behaviourTitle/);

  const draft = {
    id: "knowledge-1",
    title: "Refund FAQ",
    content: "Refund content",
    keywords: "refund, policy",
    siteId: "__global__",
    enabled: true,
  };
  const knowledge = renderUi(AiKnowledgeTab, {
    entries: [
      {
        id: "knowledge-1",
        title: "Refund FAQ",
        content: "Refund content",
        keywords: ["refund", "policy"],
        enabled: true,
        siteId: null,
        siteName: null,
        chunkCount: 2,
      },
    ],
    filteredEntries: [
      {
        id: "knowledge-1",
        title: "Refund FAQ",
        content: "Refund content",
        keywords: ["refund", "policy"],
        enabled: true,
        siteId: null,
        siteName: null,
        chunkCount: 2,
      },
    ],
    sites: [{ id: "site-1", name: "Demo Site" }],
    indexStats: { entries: 1, chunks: 2, vectorized: 0 },
    query: "",
    draft,
    activeEntry: {
      id: "knowledge-1",
      title: "Refund FAQ",
      content: "Refund content",
      keywords: ["refund", "policy"],
      enabled: true,
      siteId: null,
      siteName: null,
      chunkCount: 2,
    },
    dirty: true,
    knowledgeSaving: false,
    reindexing: null,
    onQueryChange: noop,
    onSelectEntry: noop,
    onDraftChange: noop,
    onSave: noop,
    onCancel: noop,
    onReindex: noop,
    onDelete: noop,
    onNew: noop,
  });
  assert.match(knowledge, /Refund FAQ/);
  assert.match(knowledge, /id="kb-content"/);
  assert.match(knowledge, /ai\.knowledgeUnsaved/);
  assert.match(knowledge, /ai\.reindexOne/);
  assert.match(knowledge, /common\.delete/);
});
