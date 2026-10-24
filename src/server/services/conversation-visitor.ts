import { assertTenantQuota } from "./tenants";
import { HttpError } from "../../lib/auth";
import { prisma } from "../../lib/db";
import {
  visitorConversation,
  type VisitorConversation,
} from "../../lib/realtime/public";
import type { VisitorSession } from "../../lib/visitor-auth";
import { getSiteAvailability } from "../../lib/widget";
import { filterOnlineVisitors } from "../presence";
import {
  conversationInclude,
  serializeConversation,
} from "../serialize";
import {
  broadcastConversation,
  broadcastConversationCreated,
} from "./broadcast";
import {
  createSystemMessage,
  writeMessage,
  publishMessage,
  listConversationMessages,
} from "./messages";
import {
  notifyConversationCreated,
  notifyConversationAssigned,
} from "./notifications";
import { createOfflineFollowUp } from "./follow-up-rules";
import { pickAgentForAssignment } from "./conversation-queries";

/** 访客发起会话：已有进行中的会话则复用，否则新建并按站点策略自动分配 */
export async function createConversationForVisitor(input: {
  site: {
    id: string;
    name: string;
    autoAssign: boolean;
    notifyEmail: string | null;
    workHours?: unknown;
  };
  visitor: { id: string; email: string; name: string | null };
  body: string;
  subject?: string | null;
  attachmentIds?: string[];
  clientId?: string;
  source: "WIDGET" | "OFFLINE_FORM";
}): Promise<{ conversationId: string; created: boolean }> {
  const availability = await getSiteAvailability({
    id: input.site.id,
    workHours: input.site.workHours,
  });
  const result = await prisma.$transaction(async (tx) => {
    // Two tabs sending the first message must reuse one conversation.
    await tx.$queryRaw`SELECT id FROM "Visitor" WHERE id = ${input.visitor.id} FOR UPDATE`;
    const existing = await tx.conversation.findFirst({
      where: {
        siteId: input.site.id,
        visitorId: input.visitor.id,
        OR: [
          { status: { in: ["PENDING", "OPEN"] } },
          ...(input.clientId
            ? [{ messages: { some: { clientId: input.clientId } } }]
            : []),
        ],
      },
      orderBy: { lastMessageAt: "desc" },
      select: { id: true },
    });

    if (existing) {
      const message = await writeMessage(tx, {
        conversationId: existing.id,
        siteId: input.site.id,
        sender: "VISITOR",
        body: input.body,
        attachmentIds: input.attachmentIds ?? [],
        clientId: input.clientId,
        uploaderId: input.visitor.id,
      });
      return { conversationId: existing.id, created: false as const, message };
    }

    const quotaSite = await tx.site.findUniqueOrThrow({
      where: { id: input.site.id },
      select: { tenantId: true },
    });
    await assertTenantQuota(tx, quotaSite.tenantId, "conversations");
    const assignedAgentId =
      input.site.autoAssign && availability.online
        ? await pickAgentForAssignment(input.site.id, tx)
        : null;

    const preview = (input.body ?? "").slice(0, 120);
    const conversation = await tx.conversation.create({
      data: {
        siteId: input.site.id,
        visitorId: input.visitor.id,
        source: availability.online ? "WIDGET" : "OFFLINE_FORM",
        subject: input.subject?.slice(0, 200) ?? (preview || null),
        status: assignedAgentId ? "OPEN" : "PENDING",
        assignedAgentId,
      },
    });

    const message = await writeMessage(tx, {
      conversationId: conversation.id,
      siteId: input.site.id,
      sender: "VISITOR",
      body: input.body,
      attachmentIds: input.attachmentIds ?? [],
      clientId: input.clientId,
      uploaderId: input.visitor.id,
    });
    if (!availability.online) await createOfflineFollowUp(tx, conversation.id);
    await notifyConversationCreated(
      {
        conversationId: conversation.id,
        siteId: input.site.id,
        siteName: input.site.name,
        notifyEmail: input.site.notifyEmail,
        visitorEmail: input.visitor.email,
        visitorName: input.visitor.name,
        subject: input.subject ?? null,
        preview,
        offline: !availability.online,
      },
      tx,
    );
    if (assignedAgentId) {
      const agent = await tx.user.findUnique({
        where: { id: assignedAgentId },
        select: { name: true },
      });
      await notifyConversationAssigned(
        {
          conversation: {
            id: conversation.id,
            siteId: input.site.id,
            siteName: input.site.name,
            assignedAgent: { id: assignedAgentId },
          },
          agentName: agent?.name ?? "",
        },
        tx,
      );
    }
    return {
      conversationId: conversation.id,
      created: true as const,
      message,
      assignedAgentId,
      preview,
    };
  });

  await publishMessage(result.message);
  if (!result.created)
    return { conversationId: result.conversationId, created: false };
  const { conversationId, assignedAgentId } = result;

  if (assignedAgentId) {
    const agent = await prisma.user.findUnique({
      where: { id: assignedAgentId },
      select: { name: true },
    });
    await createSystemMessage(
      conversationId,
      `已为你接入客服 ${agent?.name ?? ""}`.trim(),
    );
  }

  await broadcastConversationCreated(conversationId);

  return { conversationId, created: true };
}

/** 访客进入聊天窗时，找回进行中的会话历史 */
export async function getVisitorConversationState(
  visitor: VisitorSession,
  conversationId?: string,
  before?: string,
): Promise<{
  conversation: VisitorConversation | null;
  messages: Awaited<ReturnType<typeof listConversationMessages>>;
}> {
  const conversation = conversationId
    ? await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: conversationInclude,
      })
    : await prisma.conversation.findFirst({
        where: {
          siteId: visitor.siteId,
          visitorId: visitor.visitorId,
          status: { in: ["PENDING", "OPEN"] },
        },
        include: conversationInclude,
        orderBy: { lastMessageAt: "desc" },
      });

  if (
    !conversation ||
    conversation.visitorId !== visitor.visitorId ||
    conversation.siteId !== visitor.siteId
  ) {
    return { conversation: null, messages: [] };
  }

  const [messages, online] = await Promise.all([
    listConversationMessages({
      conversationId: conversation.id,
      forVisitor: true,
      before,
    }),
    filterOnlineVisitors([conversation.visitorId]),
  ]);

  return {
    conversation: visitorConversation(
      serializeConversation(conversation, {
        visitorOnline: online.has(conversation.visitorId),
      }),
    ),
    messages,
  };
}

export async function rateConversation(
  visitor: VisitorSession,
  conversationId: string,
  rating: number,
  comment?: string,
): Promise<void> {
  if (rating < 1 || rating > 5) throw new HttpError(400, "评分必须在 1-5 之间");

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, visitorId: true, siteId: true },
  });
  if (
    !conversation ||
    conversation.visitorId !== visitor.visitorId ||
    conversation.siteId !== visitor.siteId
  ) {
    throw new HttpError(404, "会话不存在");
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      rating,
      ratingComment: comment?.slice(0, 500) ?? null,
      ratedAt: new Date(),
    },
  });

  await broadcastConversation(conversationId);
}

export async function markVisitorSeen(visitorId: string): Promise<void> {
  await prisma.visitor.update({
    where: { id: visitorId },
    data: { lastSeenAt: new Date() },
  });
}
