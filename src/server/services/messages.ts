import { getWidgetSettings, tenantCanServe } from "./tenants";
import type { MessageType, Prisma } from "@prisma/client";

import { HttpError } from "../../lib/auth";
import { prisma } from "../../lib/db";
import { emitRead } from "../../lib/realtime/emit";
import type { VisitorSession } from "../../lib/visitor-auth";
import type { SessionUser } from "../../lib/auth";
import { canAccessSite } from "../../lib/auth";
import { messageInclude, serializeMessage } from "../serialize";
import { visitorMessage } from "../../lib/realtime/public";
import { lockConversation } from "../transactions";
import { broadcastConversation, broadcastMessage } from "./broadcast";
import { maybeAutoReply } from "./ai";
import { notifyVisitorMessage } from "./notifications";

const MAX_BODY_LENGTH = 5000;

type CreateMessageInput = {
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

async function linkAttachments(
  tx: Prisma.TransactionClient,
  input: {
    attachmentIds: string[];
    siteId: string;
    messageId: string;
    uploaderType: "VISITOR" | "AGENT";
    uploaderId: string;
  },
): Promise<number> {
  if (input.attachmentIds.length === 0) return 0;

  const result = await tx.attachment.updateMany({
    where: {
      id: { in: input.attachmentIds },
      siteId: input.siteId,
      uploader: input.uploaderType,
      uploaderId: input.uploaderId,
      messageId: null,
    },
    data: { messageId: input.messageId },
  });
  if (result.count !== input.attachmentIds.length) {
    throw new HttpError(400, "附件不存在、已发送或不属于当前用户");
  }
  return result.count;
}

function inferType(
  explicit: MessageType | undefined,
  attachmentCount: number,
  imageCount: number,
): MessageType {
  if (explicit) return explicit;
  if (attachmentCount === 0) return "TEXT";
  return imageCount > 0 && imageCount === attachmentCount ? "IMAGE" : "FILE";
}

/**
 * 写入一条消息并维护会话上的未读数、首响时间、最后消息摘要等派生字段。
 * 访客与客服两条路径共用这段逻辑。
 */
export async function insertMessage(
  input: CreateMessageInput,
): Promise<string> {
  const result = await prisma.$transaction((tx) => writeMessage(tx, input));
  await publishMessage(result);
  return result.id;
}

/** Also used by conversation creation so the first message is part of the same transaction. */
export async function writeMessage(
  tx: Prisma.TransactionClient,
  input: CreateMessageInput,
) {
  const body = (input.body ?? "").trim();
  const attachmentIds = [...new Set(input.attachmentIds ?? [])];

  if (!body && attachmentIds.length === 0) {
    throw new HttpError(400, "消息内容不能为空");
  }
  if (body.length > MAX_BODY_LENGTH) {
    throw new HttpError(400, `单条消息最长 ${MAX_BODY_LENGTH} 字`);
  }

  if (input.sender === "VISITOR" && input.uploaderId)
    await tx.$queryRaw`SELECT id FROM "Visitor" WHERE id = ${input.uploaderId} FOR UPDATE`;
  await lockConversation(tx, input.conversationId);
  // The row lock serializes retries; the unique index also protects other writers.
  if (input.clientId) {
    const existing = await tx.message.findUnique({
      where: {
        conversationId_clientId: {
          conversationId: input.conversationId,
          clientId: input.clientId,
        },
      },
      select: { id: true, sender: true, authorId: true },
    });
    if (existing) {
      if (
        existing.sender !== input.sender ||
        existing.authorId !== (input.authorId ?? null)
      ) {
        throw new HttpError(409, "消息标识已被使用");
      }
      return { id: existing.id, created: false as const };
    }
  }

  const conversation = await tx.conversation.findUnique({
    where: { id: input.conversationId },
    include: {
      site: {
        select: {
          autoAssign: true,
          name: true,
          imageReviewEnabled: true,
          active: true,
          tenant: { select: { status: true, expiresAt: true } },
        },
      },
      visitor: { select: { email: true } },
    },
  });
  if (!conversation) throw new HttpError(404, "会话不存在");
  if (conversation.siteId !== input.siteId) {
    throw new HttpError(403, "会话不属于该站点");
  }

  if (!conversation.site.active || !tenantCanServe(conversation.site.tenant))
    throw new HttpError(403, "商家服务已暂停或已到期");

  const images = attachmentIds.length
    ? await tx.attachment.count({
        where: {
          id: { in: attachmentIds },
          mimeType: { startsWith: "image/" },
        },
      })
    : 0;

  if (input.sender === "VISITOR" && attachmentIds.length) {
    const settings = await getWidgetSettings(input.siteId, tx);
    if (
      (images > 0 && !settings.imagesEnabled) ||
      (attachmentIds.length > images && !settings.filesEnabled)
    )
      throw new HttpError(403, "此站点已关闭相应附件发送功能");
  }

  if (
    input.sender === "VISITOR" &&
    images &&
    conversation.site.imageReviewEnabled
  ) {
    if (images !== 1)
      throw new HttpError(
        409,
        "当前站点每次只能发送一张图片，需客服允许后继续",
      );
    const visitorId = input.uploaderId ?? conversation.visitorId;
    const [visitor, image] = await Promise.all([
      tx.visitor.findUnique({
        where: { id: visitorId },
        select: { pendingImageId: true },
      }),
      tx.attachment.findFirst({
        where: {
          id: { in: attachmentIds },
          mimeType: { startsWith: "image/" },
          siteId: input.siteId,
          uploader: "VISITOR",
          uploaderId: visitorId,
        },
        select: { id: true },
      }),
    ]);
    if (!visitor || !image) throw new HttpError(400, "图片不属于当前访客");
    if (
      visitor.pendingImageId &&
      visitor.pendingImageId !== image.id &&
      (await tx.attachment.findFirst({
        where: { id: visitor.pendingImageId, imageReviewState: "PENDING" },
        select: { id: true },
      }))
    )
      throw new HttpError(409, "请等待客服允许后再发送下一张图片");
    await tx.visitor.update({
      where: { id: visitorId },
      data: { pendingImageId: image.id },
    });
    await tx.attachment.update({
      where: { id: image.id },
      data: { imageReviewState: "PENDING" },
    });
  }

  const message = await tx.message.create({
    data: {
      conversationId: input.conversationId,
      sender: input.sender,
      type: inferType(input.type, attachmentIds.length, images),
      body,
      authorId: input.authorId ?? null,
      authorName: input.authorName ?? null,
      clientId: input.clientId ?? null,
      readByAgentAt: input.sender === "AGENT" ? new Date() : null,
    },
  });

  await linkAttachments(tx, {
    attachmentIds,
    siteId: input.siteId,
    messageId: message.id,
    uploaderType: input.sender,
    uploaderId: input.uploaderId ?? input.authorId ?? conversation.visitorId,
  });

  const preview = body
    ? body.slice(0, 120)
    : attachmentIds.length > 0
      ? "[文件]"
      : "";

  const now = new Date();
  const data: Prisma.ConversationUpdateInput = {
    lastMessageAt: now,
    lastMessagePreview: preview,
    updatedAt: now,
  };

  if (input.sender === "VISITOR") {
    if (!conversation.waitingMessageId || conversation.status === "CLOSED") {
      data.waitingSince = message.createdAt;
      data.waitingMessageId = message.id;
    }
    data.unreadForAgent = { increment: 1 };
    // 访客重新发消息：已结束的会话自动回到待接入
    if (conversation.status === "CLOSED") {
      data.status = "PENDING";
      data.closedAt = null;
      data.closedById = null;
    }
  } else {
    if (["TEXT", "IMAGE", "FILE"].includes(message.type)) {
      data.waitingSince = null;
      data.waitingMessageId = null;
      if (conversation.waitingMessageId) {
        await tx.unansweredReminder.updateMany({
          where: { conversationId: input.conversationId, resolvedAt: null },
          data: { resolvedAt: now, resolution: "REPLIED" },
        });
      }
    }
    await tx.message.updateMany({
      where: {
        conversationId: input.conversationId,
        sender: "VISITOR",
        readByAgentAt: null,
      },
      data: { readByAgentAt: now },
    });
    data.unreadForVisitor = { increment: 1 };
    data.unreadForAgent = 0;
    if (!conversation.firstResponseAt) {
      data.firstResponseAt = now;
    }
    if (conversation.status !== "OPEN") {
      data.status = "OPEN";
      data.closedAt = null;
      data.closedById = null;
    }
    if (!conversation.assignedAgentId && input.authorId) {
      data.assignedAgent = { connect: { id: input.authorId } };
    }
  }

  await tx.conversation.update({
    where: { id: input.conversationId },
    data,
  });

  if (input.sender === "VISITOR") {
    await notifyVisitorMessage(
      {
        conversationId: input.conversationId,
        siteId: input.siteId,
        siteName: conversation.site.name,
        visitorEmail: conversation.visitor.email,
        preview,
      },
      tx,
    );
  }

  return {
    id: message.id,
    created: true as const,
    input,
    conversation,
    preview,
  };
}

export async function publishMessage(
  result: Awaited<ReturnType<typeof writeMessage>>,
): Promise<void> {
  if (!result.created) return;
  const { id, input } = result;
  // A transport failure after commit must not turn a successful send into an API failure.
  await Promise.allSettled([
    broadcastMessage(id),
    broadcastConversation(input.conversationId),
  ]);

  // Notifications were committed with the message; AI runs after commit.
  if (input.sender === "VISITOR") {
    // AI 自动回复（判定条件见 services/ai）
    scheduleAutoReply(input.conversationId);
  }
}

export async function postVisitorMessage(input: {
  visitor: VisitorSession;
  conversationId: string;
  body: string;
  clientId?: string | null;
  attachmentIds?: string[];
}): Promise<string> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, siteId: true, visitorId: true },
  });
  if (!conversation) throw new HttpError(404, "会话不存在");
  if (
    conversation.visitorId !== input.visitor.visitorId ||
    conversation.siteId !== input.visitor.siteId
  ) {
    throw new HttpError(403, "无权访问该会话");
  }

  await prisma.visitor.update({
    where: { id: input.visitor.visitorId },
    data: { lastSeenAt: new Date() },
  });

  return insertMessage({
    conversationId: conversation.id,
    siteId: conversation.siteId,
    sender: "VISITOR",
    body: input.body,
    clientId: input.clientId ?? null,
    attachmentIds: input.attachmentIds ?? [],
    authorId: null,
    authorName: null,
    uploaderId: input.visitor.visitorId,
  });
}

export async function postAgentMessage(input: {
  user: SessionUser;
  conversationId: string;
  body: string;
  type?: MessageType;
  clientId?: string | null;
  attachmentIds?: string[];
}): Promise<string> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, siteId: true },
  });
  if (!conversation) throw new HttpError(404, "会话不存在");
  if (!canAccessSite(input.user, conversation.siteId)) {
    throw new HttpError(403, "无权访问该站点");
  }

  await prisma.user.update({
    where: { id: input.user.id },
    data: { lastSeenAt: new Date() },
  });

  return insertMessage({
    conversationId: conversation.id,
    siteId: conversation.siteId,
    sender: "AGENT",
    type: input.type,
    body: input.body,
    clientId: input.clientId ?? null,
    attachmentIds: input.attachmentIds ?? [],
    authorId: input.user.id,
    authorName: input.user.name,
    uploaderId: input.user.id,
  });
}

/**
 * 访客消息入库后的 AI 自动回复钩子。
 * 只做触发，判定与调用都在 services/ai 里；失败只记日志，不影响访客发消息。
 */
function scheduleAutoReply(conversationId: string): void {
  void maybeAutoReply(conversationId).catch((error: unknown) => {
    console.error("[ai] 自动回复调度失败:", error);
  });
}

/** 内部备注：访客不可见，只作为一条 NOTE 消息存进会话 */
export async function postInternalNote(input: {
  user: SessionUser;
  conversationId: string;
  body: string;
}): Promise<string> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, siteId: true },
  });
  if (!conversation) throw new HttpError(404, "会话不存在");
  if (!canAccessSite(input.user, conversation.siteId)) {
    throw new HttpError(403, "无权访问该站点");
  }

  const message = await prisma.message.create({
    data: {
      conversationId: input.conversationId,
      sender: "AGENT",
      type: "NOTE",
      body: input.body.slice(0, MAX_BODY_LENGTH),
      authorId: input.user.id,
      authorName: input.user.name,
      readByAgentAt: new Date(),
    },
  });

  await broadcastMessage(message.id);
  return message.id;
}

export async function createSystemMessage(
  conversationId: string,
  body: string,
): Promise<void> {
  const message = await prisma.message.create({
    data: { conversationId, sender: "SYSTEM", type: "SYSTEM", body },
  });
  await broadcastMessage(message.id);
}

export async function markConversationRead(
  input: {
    conversationId: string;
  } & (
    | { by: "AGENT"; user: SessionUser }
    | { by: "VISITOR"; visitor: VisitorSession }
  ),
): Promise<void> {
  const conversation = await prisma.$transaction(async (tx) => {
    await lockConversation(tx, input.conversationId);
    const conversation = await tx.conversation.findUnique({
      where: { id: input.conversationId },
      select: { siteId: true, visitorId: true },
    });
    if (!conversation) throw new HttpError(404, "会话不存在");
    if (
      input.by === "AGENT"
        ? !canAccessSite(input.user, conversation.siteId)
        : input.visitor.visitorId !== conversation.visitorId ||
          input.visitor.siteId !== conversation.siteId
    ) {
      throw new HttpError(403, "无权访问该会话");
    }
    const now = new Date();

    if (input.by === "AGENT") {
      await tx.message.updateMany({
        where: {
          conversationId: input.conversationId,
          sender: "VISITOR",
          readByAgentAt: null,
        },
        data: { readByAgentAt: now },
      });
      await tx.conversation.update({
        where: { id: input.conversationId },
        data: { unreadForAgent: 0 },
      });
    } else {
      await tx.message.updateMany({
        where: {
          conversationId: input.conversationId,
          sender: { in: ["AGENT", "AI"] },
          type: { not: "NOTE" },
          readByVisitorAt: null,
        },
        data: { readByVisitorAt: now },
      });
      await tx.conversation.update({
        where: { id: input.conversationId },
        data: { unreadForVisitor: 0 },
      });
    }

    return conversation;
  });

  emitRead({
    conversationId: input.conversationId,
    by: input.by,
    visitorId: conversation.visitorId,
  });
  await broadcastConversation(input.conversationId);
}

export async function listConversationMessages(input: {
  conversationId: string;
  limit?: number;
  before?: string;
  /** 访客侧调用：过滤掉内部备注 */
  forVisitor?: boolean;
}): Promise<ReturnType<typeof serializeMessage>[]> {
  const messages = await prisma.message.findMany({
    where: {
      conversationId: input.conversationId,
      ...(input.forVisitor ? { type: { not: "NOTE" } } : {}),
    },
    include: messageInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(200, Math.max(1, input.limit ?? 200)),
    ...(input.before ? { cursor: { id: input.before }, skip: 1 } : {}),
  });

  return messages.reverse().map((message) => {
    const serialized = serializeMessage(message);
    return input.forVisitor ? visitorMessage(serialized) : serialized;
  });
}
