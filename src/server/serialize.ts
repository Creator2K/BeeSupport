import type {
  Attachment,
  Conversation,
  Message,
  Site,
  User,
  Visitor,
} from "@prisma/client";

import type {
  SerializedAttachment,
  SerializedConversation,
  SerializedMessage,
  SerializedVisitor,
} from "../lib/realtime/types";

/** 会话查询时统一 include 这些关系，序列化才有完整信息 */
export const conversationInclude = {
  site: { select: { id: true, name: true, tenantId: true } },
  visitor: true,
  assignedAgent: {
    select: { id: true, name: true, email: true, avatarUrl: true },
  },
  _count: { select: { messages: true } },
} as const;

export const messageInclude = { attachments: true } as const;

export type ConversationRecord = Conversation & {
  site: Pick<Site, "id" | "name"> & { tenantId?: string };
  visitor: Visitor;
  assignedAgent: Pick<User, "id" | "name" | "email" | "avatarUrl"> | null;
  _count?: { messages: number };
};

export type MessageRecord = Message & { attachments: Attachment[] };

export function serializeAttachment(
  attachment: Attachment,
): SerializedAttachment {
  return {
    id: attachment.id,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.size,
    url: `/api/files/${attachment.id}`,
    isImage: attachment.mimeType.startsWith("image/"),
    imageReviewState: attachment.imageReviewState ?? "NONE",
  };
}

export function serializeMessage(message: MessageRecord): SerializedMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    sender: message.sender,
    type: message.type,
    body: message.body,
    authorId: message.authorId,
    authorName: message.authorName,
    createdAt: message.createdAt.toISOString(),
    readByAgentAt: message.readByAgentAt?.toISOString() ?? null,
    readByVisitorAt: message.readByVisitorAt?.toISOString() ?? null,
    clientId: message.clientId,
    attachments: message.attachments.map(serializeAttachment),
    meta: (message.meta ?? null) as Record<string, unknown> | null,
  };
}

/** 访客档案：身份 + 环境指纹 + 访问轨迹 */
export function serializeVisitor(
  visitor: Visitor,
  options: { visitorOnline: boolean },
): SerializedVisitor {
  return {
    id: visitor.id,
    email: visitor.email,
    name: visitor.name,
    lastSeenAt: visitor.lastSeenAt.toISOString(),
    firstSeenAt: visitor.firstSeenAt.toISOString(),
    online: options.visitorOnline,
    meta: (visitor.meta ?? null) as Record<string, unknown> | null,
    visitCount: visitor.visitCount,
    pageViews: visitor.pageViews,
    landingPage: visitor.landingPage,
    lastPage: visitor.lastPage,
    lastPageTitle: visitor.lastPageTitle,
    referrer: visitor.referrer,
    profileTags: visitor.profileTags,
    profileNote: visitor.profileNote,
    blocked: visitor.blocked,
  };
}

export function serializeConversation(
  conversation: ConversationRecord,
  options: { visitorOnline: boolean },
): SerializedConversation {
  return {
    id: conversation.id,
    siteId: conversation.siteId,
    tenantId: conversation.site.tenantId,
    siteName: conversation.site.name,
    status: conversation.status,
    source: conversation.source,
    subject: conversation.subject,
    tags: conversation.tags,
    note: conversation.note,
    priority: conversation.priority,
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    lastMessagePreview: conversation.lastMessagePreview,
    unreadForAgent: conversation.unreadForAgent,
    unreadForVisitor: conversation.unreadForVisitor,
    firstResponseAt: conversation.firstResponseAt?.toISOString() ?? null,
    rating: conversation.rating,
    ratingComment: conversation.ratingComment,
    closedAt: conversation.closedAt?.toISOString() ?? null,
    createdAt: conversation.createdAt.toISOString(),
    messageCount: conversation._count?.messages,
    visitor: serializeVisitor(conversation.visitor, options),
    assignedAgent: conversation.assignedAgent
      ? {
          id: conversation.assignedAgent.id,
          name: conversation.assignedAgent.name,
          email: conversation.assignedAgent.email,
          avatarUrl: conversation.assignedAgent.avatarUrl,
        }
      : null,
  };
}
