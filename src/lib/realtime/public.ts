import type { SerializedConversation, SerializedMessage } from "./types";

/** Explicit allowlists: adding an internal field never makes it public. */
export function visitorConversation(conversation: SerializedConversation) {
  return {
    id: conversation.id,
    siteId: conversation.siteId,
    siteName: conversation.siteName,
    status: conversation.status,
    source: conversation.source,
    subject: conversation.subject,
    lastMessageAt: conversation.lastMessageAt,
    unreadForVisitor: conversation.unreadForVisitor,
    rating: conversation.rating,
    ratingComment: conversation.ratingComment,
    closedAt: conversation.closedAt,
    createdAt: conversation.createdAt,
    visitor: {
      id: conversation.visitor.id,
      email: conversation.visitor.email,
      name: conversation.visitor.name,
    },
    assignedAgent: conversation.assignedAgent
      ? {
          name: conversation.assignedAgent.name,
          avatarUrl: conversation.assignedAgent.avatarUrl,
        }
      : null,
  };
}

export type VisitorConversation = ReturnType<typeof visitorConversation>;

export function visitorMessage(message: SerializedMessage): SerializedMessage {
  return { ...message, authorId: null, meta: null };
}
