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
const { VisitorProfileSection } = loadUiModule(
  "src/components/agent/visitor-profile-section.tsx",
);
const { VisitorHistorySection } = loadUiModule(
  "src/components/agent/visitor-history-section.tsx",
);
const { VisitorConversationFields } = loadUiModule(
  "src/components/agent/visitor-conversation-fields.tsx",
);
const { AiConnectionTab } = loadUiModule(
  "src/app/admin/ai/ai-connection-tab.tsx",
);
const { AiPromptTab } = loadUiModule("src/app/admin/ai/ai-prompt-tab.tsx");
const { AiKnowledgeTab } = loadUiModule(
  "src/app/admin/ai/ai-knowledge-tab.tsx",
);
const { WebhookList } = loadUiModule(
  "src/app/admin/webhooks/webhook-list.tsx",
);
const { WebhookFormDialog } = loadUiModule(
  "src/app/admin/webhooks/webhook-form-dialog.tsx",
);
const { AdminShellHeader } = loadUiModule(
  "src/components/admin/admin-shell-header.tsx",
);
const { NavContent } = loadUiModule(
  "src/components/admin/admin-nav-content.tsx",
);
const { WechatLoginActions } = loadUiModule(
  "src/components/admin/wechat-login-actions.tsx",
);
const { WechatLoginConfig } = loadUiModule(
  "src/components/admin/wechat-login-config.tsx",
);
const { WechatLoginLogs } = loadUiModule(
  "src/components/admin/wechat-login-logs.tsx",
);
const { WechatLoginVisual } = loadUiModule(
  "src/components/admin/wechat-login-visual.tsx",
);
const { SubscriptionOrderCard } = loadUiModule(
  "src/components/admin/subscription-order-card.tsx",
);
const { OrderDecisionDialog } = loadUiModule(
  "src/components/admin/order-decision-dialog.tsx",
);
const { VisitorMetricCards } = loadUiModule(
  "src/components/admin/visitor-metric-cards.tsx",
);
const { VisitorTrend } = loadUiModule(
  "src/components/admin/visitor-trend.tsx",
);
const { VisitorBreakdown } = loadUiModule(
  "src/components/admin/visitor-breakdown.tsx",
);
const { VisitorSitesTable } = loadUiModule(
  "src/components/admin/visitor-sites-table.tsx",
);
const { BrandingStylePicker } = loadUiModule(
  "src/components/admin/branding-style-picker.tsx",
);
const { BrandingSettingFields } = loadUiModule(
  "src/components/admin/branding-setting-fields.tsx",
);
const { BrandingPreview } = loadUiModule(
  "src/components/admin/branding-preview.tsx",
);
const { SubscriptionPlanCard } = loadUiModule(
  "src/components/admin/subscription-plan-card.tsx",
);
const { SubscriptionOrderDialog } = loadUiModule(
  "src/components/admin/subscription-order-dialog.tsx",
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

test("subscription order card and decision dialog render order actions", () => {
  const order = {
    id: "order-1",
    orderNo: "BS202610230001",
    tenantName: "Demo Merchant",
    status: "PENDING",
    planName: "Pro Plan",
    features: {},
    priceCents: 9900,
    durationDays: 30,
    maxAgents: 10,
    maxSites: 3,
    monthlyConversations: 5000,
    storageMB: 2048,
    merchantNote: "Please activate",
    reviewNote: "",
    requestedByName: "Merchant Admin",
    reviewedByName: null,
    paymentReference: "",
    paymentReportedAt: "2026-10-23T09:00:00.000Z",
    paymentNote: "Paid by transfer",
    paymentReportVersion: 1,
    createdAt: "2026-10-23T08:00:00.000Z",
    validUntil: "2026-10-24T08:00:00.000Z",
    periodStart: null,
    periodEnd: null,
    reviewedAt: null,
  };
  const card = renderUi(SubscriptionOrderCard, {
    order,
    platform: true,
    onDecision: noop,
  });
  assert.match(card, /pending|payment-report/);
  assert.match(card, /BS202610230001/);
  assert.match(card, /Demo Merchant/);

  const dialog = renderUi(OrderDecisionDialog, {
    selected: order,
    decision: "CONFIRMED",
    note: "",
    reference: "BANK-001",
    ack: true,
    pending: false,
    error: "",
    onOpenChange: noop,
    onNoteChange: noop,
    onReferenceChange: noop,
    onAckChange: noop,
    onSubmit: noop,
  });
  assert.match(dialog, /id="payment-reference"/);
  assert.match(dialog, /id="order-review-note"/);
  assert.ok(dialog.includes("\u786e\u8ba4\u6536\u6b3e\u5e76\u5f00\u901a"));
});

test("visitor insights split components render metrics, trend and breakdowns", () => {
  const totals = {
    visitors: 6,
    visits: 12,
    views: 30,
    returning: 2,
    consulted: 2,
    active7: 4,
    blocked: 1,
  };
  const metrics = renderUi(VisitorMetricCards, { totals });
  assert.match(metrics, /\u7d2f\u8ba1\u8bbf\u5ba2/);
  assert.match(metrics, /33\.3%/);
  assert.match(metrics, /\u8eab\u4efd\u88ab\u5c01\u7981/);

  const trend = renderUi(VisitorTrend, {
    trend: [
      { day: "2026-10-01", count: 1 },
      { day: "2026-10-02", count: 2 },
      { day: "2026-10-03", count: 3 },
    ],
    totalVisitors: totals.visitors,
  });
  assert.match(trend, /\u65b0\u589e\u8bbf\u5ba2\u8d8b\u52bf/);
  assert.match(trend, /2026-10-01/);
  assert.match(trend, /\u5408\u8ba1 6 \u4f4d\u65b0\u589e\u8bbf\u5ba2/);

  const breakdown = renderUi(VisitorBreakdown, {
    title: "Device",
    rows: [{ label: "Mobile", count: 4 }],
    total: totals.visitors,
  });
  assert.match(breakdown, /66\.7%/);
  assert.match(breakdown, /\u5176\u4ed6/);

  const sites = renderUi(VisitorSitesTable, {
    adminPath: "/console-test",
    sites: [
      {
        id: "site-1",
        name: "Demo Site",
        visitors: 6,
        visits: 12,
        views: 30,
        consulted: 2,
      },
    ],
  });
  assert.match(sites, /Demo Site/);
  assert.match(sites, /\/console-test\/visitors\?siteId=site-1/);
});

test("subscription catalog split components render plans and order confirmation", () => {
  const plan = {
    id: "plan-1",
    name: "Pro Plan",
    description: "For growing teams",
    priceCents: 9900,
    durationDays: 30,
    maxAgents: 10,
    maxSites: 3,
    monthlyConversations: 5000,
    storageMB: 2048,
    features: {},
    updatedAt: "2026-10-23T09:00:00.000Z",
  };
  const usage = {
    agents: 4,
    sites: 2,
    conversations: 1000,
    storageBytes: 1048576,
  };
  const card = renderUi(SubscriptionPlanCard, {
    plan,
    usage,
    pendingOrder: false,
    onSelect: noop,
  });
  assert.match(card, /Pro Plan/);
  assert.match(card, /99\.00/);
  assert.match(card, /\u9009\u62e9\u5957\u9910/);

  const conflict = renderUi(SubscriptionPlanCard, {
    plan,
    usage: { ...usage, agents: 20 },
    pendingOrder: false,
    onSelect: noop,
  });
  assert.match(conflict, /Current usage exceeds the plan/);

  const dialog = renderUi(SubscriptionOrderDialog, {
    plan,
    longTerm: true,
    onClose: noop,
    onSubmitted: noop,
  });
  assert.match(dialog, /\u786e\u8ba4\u5957\u9910\u8ba2\u5355/);
  assert.match(dialog, /merchant-order-note/);
  assert.match(dialog, /\u957f\u671f\u6709\u6548/);
  assert.match(dialog, /\u63d0\u4ea4\u8ba2\u5355/);
});

test("branding split components render style controls, fields and preview", () => {
  const settings = {
    title: "Product Chat",
    logoUrl: "",
    footerText: "Powered by Demo",
    primaryColor: "#336699",
    position: "right",
    launcherStyle: "pill",
    launcherLabel: "Chat with us",
    imagesEnabled: true,
    filesEnabled: false,
    emojiEnabled: true,
    ratingEnabled: true,
    maxUploadMB: 8,
  };
  const value = {
    title: "Product Chat",
    launcherStyle: "pill",
    primaryColor: "#336699",
  };

  const styles = renderUi(BrandingStylePicker, {
    value,
    settings,
    onChange: noop,
  });
  assert.match(styles, /\u60ac\u6d6e\u6309\u94ae\u6837\u5f0f/);
  assert.match(styles, /Classic bubble/);
  assert.match(styles, /Balanced launcher/);

  const fields = renderUi(BrandingSettingFields, {
    value,
    settings,
    canCustomizeFooter: false,
    onChange: noop,
  });
  assert.match(fields, /\u804a\u5929\u7a97\u53e3\u6807\u9898/);
  assert.match(fields, /\u5e95\u90e8\u54c1\u724c\u6587\u5b57/);
  assert.match(fields, /\u5df2\u5f00\u542f/);

  const preview = renderUi(BrandingPreview, { settings, mobile: true });
  assert.match(preview, /Product Chat/);
  assert.match(preview, /Powered by Demo/);
  assert.match(preview, /max-w-\[280px\]/);
  assert.match(preview, /launcher:Chat with us/);
});

test("WeChat login split components render status, actions and config", () => {
  const state = {
    status: "online",
    qrUrl: null,
    scanned: false,
    account: { userId: "wx-user", accountId: "wx-account" },
    error: null,
    hasCredentials: true,
    running: true,
    storageDir: "./data/uploads/wechatbot",
    logs: [
      {
        at: "2026-10-23T09:00:00.000Z",
        level: "info",
        message: "WeChat connected",
      },
    ],
  };
  const visual = renderUi(WechatLoginVisual, {
    state,
    accountLabel: "wx-user",
  });
  assert.match(visual, /wechat\.loggedInAs/);

  const actions = renderUi(WechatLoginActions, {
    state,
    busy: null,
    waiting: false,
    onStart: noop,
    onRestart: noop,
    onStop: noop,
    onLogout: noop,
    onRefresh: noop,
  });
  assert.match(actions, /wechat\.stop/);
  assert.match(actions, /wechat\.logout/);
  assert.match(actions, /common\.refresh/);

  const config = renderUi(WechatLoginConfig, {
    state,
    config: { enabled: true, defaultTo: "wx-user" },
    defaultTo: "wx-user",
    testTo: "",
    busy: null,
    savingTo: false,
    onEnabledChange: noop,
    onDefaultToChange: noop,
    onSaveDefaultTo: noop,
    onTestToChange: noop,
    onSendTest: noop,
  });
  assert.match(config, /wechat\.enabled/);
  assert.match(config, /wechat\.defaultTo/);
  assert.match(config, /wechat\.sendTest/);
  assert.match(config, /wechat\.storageHint/);

  const logs = renderUi(WechatLoginLogs, {
    logs: state.logs,
    open: true,
    clockReady: true,
    onToggle: noop,
  });
  assert.match(logs, /wechat\.logs/);
  assert.match(logs, /WeChat connected/);
  assert.match(logs, /09:00:00/);
});

test("admin shell header and navigation expose workspace routes", () => {
  const groups = [
    {
      id: "overview",
      label: "nav.workspace",
      defaultOpen: true,
      items: [
        { path: "", label: "nav.overview", icon: "overview" },
        {
          path: "/merchants",
          label: "nav.merchants",
          icon: "merchants",
          count: "merchants",
        },
      ],
    },
  ];
  const user = {
    id: "admin-1",
    name: "Admin",
    email: "admin@example.test",
    role: "ADMIN",
    counts: { merchants: 3 },
  };
  const navigation = renderUi(NavContent, {
    user,
    basePath: "/console-test",
    groups,
    closedGroups: {},
    toggleGroup: noop,
    collapsed: false,
    onNavigate: noop,
  });
  assert.match(navigation, /nav\.platformConsole/);
  assert.match(navigation, /nav\.overview/);
  assert.match(navigation, /nav\.merchants/);
  assert.match(navigation, /\/console-test\/merchants/);

  const header = renderUi(AdminShellHeader, {
    collapsed: false,
    mobileOpen: false,
    onMobileOpenChange: noop,
    onToggleCollapsed: noop,
    activeGroup: groups[0],
    activeItem: groups[0].items[1],
    mobileNav: React.createElement("span", null, "mobile-navigation"),
  });
  assert.match(header, /nav\.workspace/);
  assert.match(header, /nav\.merchants/);
  assert.match(header, /nav\.workbench/);
  assert.match(header, /mobile-navigation/);
});

test("webhook list and form render channel controls", () => {
  const endpoint = {
    id: "webhook-1",
    name: "Ops webhook",
    type: "GENERIC",
    url: "https://hooks.example.test/endpoint",
    secret: "secret",
    events: ["message.created"],
    siteId: null,
    siteName: null,
    active: true,
    lastStatus: "success",
    lastTriggeredAt: null,
  };
  const list = renderUi(WebhookList, {
    endpoints: [endpoint],
    testingId: null,
    onNew: noop,
    onEdit: noop,
    onTest: noop,
    onDelete: noop,
    onToggle: noop,
  });
  assert.match(list, /Ops webhook/);
  assert.match(list, /webhooks\.typeGeneric/);
  assert.match(list, /webhooks\.eventMessageCreated/);
  assert.match(list, /webhooks\.test/);

  const form = renderUi(WebhookFormDialog, {
    platform: false,
    open: true,
    onOpenChange: noop,
    endpoint: null,
    sites: [{ id: "site-1", name: "Demo Site" }],
    onSaved: noop,
  });
  assert.match(form, /id="webhook-name"/);
  assert.match(form, /id="webhook-url"/);
  assert.match(form, /webhooks\.eventsLabel/);
  assert.match(form, /webhooks\.siteScope/);
  assert.match(form, /common\.save/);
});

test("visitor panel sections render profile, history and edit controls", () => {
  const conversation = {
    id: "conversation-1",
    siteName: "Demo Site",
    firstResponseAt: new Date().toISOString(),
    messageCount: 12,
    visitor: {
      id: "visitor-1",
      name: "Visitor",
      email: "visitor@example.test",
      online: true,
      blocked: false,
      profileTags: ["VIP"],
      profileNote: "Priority customer",
      visitCount: 3,
      pageViews: 8,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      landingPage: "https://example.test/pricing",
      lastPage: "https://example.test/docs",
      lastPageTitle: "Docs",
      referrer: "https://search.example.test/",
      meta: {
        screen: "1920x1080",
        dpr: 2,
        locale: "zh-CN",
        timezone: "Asia/Shanghai",
      },
    },
  };
  const profile = renderUi(VisitorProfileSection, {
    conversation,
    historyCount: 4,
    profileHref: "/admin/visitors/visitor-1",
  });
  assert.match(profile, /visitor@example\.test/);
  assert.match(profile, /VIP/);
  assert.match(profile, /Priority customer/);
  assert.match(profile, /Demo Site/);
  assert.match(profile, /Desktop/);
  assert.match(profile, /Windows/);

  const history = renderUi(VisitorHistorySection, {
    history: [
      {
        id: "conversation-old",
        subject: "Old issue",
        lastMessagePreview: "Preview",
        status: "CLOSED",
        createdAt: new Date().toISOString(),
        messageCount: 4,
        agentName: "Agent One",
        rating: 5,
      },
    ],
    loading: false,
    onRefresh: noop,
    onOpenConversation: noop,
  });
  assert.match(history, /Old issue/);
  assert.match(history, /conversations\.statusClosed/);
  assert.match(history, /Agent One/);

  const fields = renderUi(VisitorConversationFields, {
    subject: "Subject",
    tags: ["vip", "billing"],
    tagDraft: "new-tag",
    note: "Internal note",
    priority: "2",
    rating: 4,
    ratingComment: "Good service",
    pending: false,
    onSubjectChange: noop,
    onSaveSubject: noop,
    onTagDraftChange: noop,
    onAddTag: noop,
    onRemoveTag: noop,
    onPriorityChange: noop,
    onNoteChange: noop,
    onSaveNote: noop,
  });
  assert.match(fields, /id="conversation-subject"/);
  assert.match(fields, /common\.tags/);
  assert.match(fields, /Internal note/);
  assert.match(fields, /workbench\.ratingLabel/);
  assert.match(fields, /Good service/);
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
