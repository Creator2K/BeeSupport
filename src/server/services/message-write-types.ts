import type { MessageType, Prisma } from "@prisma/client";

export const MAX_BODY_LENGTH = 5000;

export type CreateMessageInput = {
  conversationId: string;
  siteId: string;
  sender: "VISITOR" | "AGENT";
  body: string;
  type?: MessageType;
  authorId?: string | null;
  uploaderId?: string;
  authorName?: string | null;
  clientId?: string | null;
  attachmentIds?: string[];
};

export type MessageConversation = Prisma.ConversationGetPayload<{
  include: {
    site: {
      select: {
        autoAssign: true;
        name: true;
        imageReviewEnabled: true;
        active: true;
        tenant: { select: { status: true; expiresAt: true } };
      };
    };
    visitor: { select: { email: true } };
  };
}>;

export type WrittenMessage = {
  id: string;
  type: MessageType;
  createdAt: Date;
};
