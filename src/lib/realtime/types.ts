/**
 * 实时通道的事件与数据结构。
 * 客户端（客服工作台 / 访客端）与服务端共用这一份类型定义。
 */

export type SerializedAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  isImage: boolean;
  imageReviewState?: string;
};

export type SerializedMessage = {
  id: string;
  conversationId: string;
  sender: "VISITOR" | "AGENT" | "SYSTEM" | "AI";
  type: "TEXT" | "IMAGE" | "FILE" | "SYSTEM" | "NOTE";
  body: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
  readByAgentAt: string | null;
  readByVisitorAt: string | null;
  clientId: string | null;
  attachments: SerializedAttachment[];
  /** 附加信息：AI 模型、工具调用轨迹、知识库命中 */
  meta: Record<string, unknown> | null;
};

export type SerializedVisitor = {
  id: string;
  email: string;
  name: string | null;
  lastSeenAt: string;
  firstSeenAt: string;
  online: boolean;
  meta: Record<string, unknown> | null;
  /** 访问轨迹 */
  visitCount: number;
  pageViews: number;
  landingPage: string | null;
  lastPage: string | null;
  lastPageTitle: string | null;
  referrer: string | null;
  profileTags: string[];
  profileNote: string | null;
  blocked: boolean;
};

/** 访客的历史会话摘要（工作台访客面板） */
export type VisitorConversationSummary = {
  id: string;
  status: "PENDING" | "OPEN" | "CLOSED";
  subject: string | null;
  tags: string[];
  lastMessageAt: string;
  lastMessagePreview: string | null;
  createdAt: string;
  rating: number | null;
  messageCount: number;
  agentName: string | null;
};

export type SerializedAgent = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
};

export type SerializedConversation = {
  tenantId?: string;
  id: string;
  siteId: string;
  siteName: string;
  status: "PENDING" | "OPEN" | "CLOSED";
  source: "WIDGET" | "OFFLINE_FORM";
  subject: string | null;
  tags: string[];
  note: string | null;
  priority: number;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  unreadForAgent: number;
  unreadForVisitor: number;
  firstResponseAt: string | null;
  rating: number | null;
  ratingComment: string | null;
  closedAt: string | null;
  createdAt: string;
  visitor: SerializedVisitor;
  assignedAgent: SerializedAgent | null;
  messageCount?: number;
};

export type AgentPresenceStatus = "ONLINE" | "AWAY" | "OFFLINE";

export type ServerToClientEvents = {
  "session:ready": () => void;
  "session:revoked": () => void;
  "message:new": (payload: {
    conversationId: string;
    message: SerializedMessage;
    conversation: SerializedConversation;
  }) => void;
  "conversation:created": (payload: {
    conversation: SerializedConversation;
  }) => void;
  "conversation:updated": (payload: {
    conversation: SerializedConversation;
  }) => void;
  "conversation:read": (payload: {
    conversationId: string;
    by: "VISITOR" | "AGENT";
  }) => void;
  typing: (payload: {
    conversationId: string;
    from: "VISITOR" | "AGENT";
    name?: string;
    isTyping: boolean;
  }) => void;
  "presence:agent": (payload: {
    userId: string;
    status: AgentPresenceStatus;
  }) => void;
  "presence:visitor": (payload: { visitorId: string; online: boolean }) => void;
};

export type ClientToServerEvents = {
  "conversation:join": (
    payload: { conversationId: string },
    ack?: (result: { ok: boolean; error?: string }) => void,
  ) => void;
  "conversation:leave": (payload: { conversationId: string }) => void;
  typing: (payload: { conversationId: string; isTyping: boolean }) => void;
  "agent:status": (payload: { status: AgentPresenceStatus }) => void;
  "visitor:ping": () => void;
};

export const SOCKET_PATH = "/socket.io";
