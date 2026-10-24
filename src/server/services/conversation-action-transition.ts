import { HttpError } from "../../lib/auth";
import type { SessionUser } from "../../lib/auth";
import type { SerializedConversation } from "../../lib/realtime/types";
import {
  notifyConversationClosed,
  notifyConversationAssigned,
} from "./notifications";
import { transitionConversation } from "./conversation-action-core";

export async function claimConversation(
  user: SessionUser,
  conversationId: string,
): Promise<SerializedConversation> {
  const result = await transitionConversation(
    user,
    conversationId,
    async (current) => {
      if (current.status === "CLOSED")
        throw new HttpError(400, "会话已结束，无法接入");
      if (current.status === "OPEN" && current.assignedAgentId) {
        if (current.assignedAgentId === user.id) return null;
        throw new HttpError(409, "会话已被其他客服接入，请刷新后重试");
      }
      return {
        data: {
          assignedAgentId: user.id,
          status: "OPEN",
          closedAt: null,
          closedById: null,
        },
        body: `客服 ${user.name} 已接入会话`,
      };
    },
    (conversation, tx) =>
      notifyConversationAssigned({ conversation, agentName: user.name }, tx),
  );
  return result.conversation;
}

export async function transferConversation(
  user: SessionUser,
  conversationId: string,
  targetAgentId: string,
): Promise<SerializedConversation> {
  const result = await transitionConversation(
    user,
    conversationId,
    async (conversation, tx) => {
      if (conversation.status === "CLOSED")
        throw new HttpError(400, "请先重新打开会话再转接");
      const target = await tx.user.findUnique({
        where: { id: targetAgentId },
        select: {
          id: true,
          name: true,
          active: true,
          role: true,
          tenantId: true,
          sites: { select: { siteId: true } },
        },
      });
      if (!target || !target.active)
        throw new HttpError(404, "目标客服不存在或已禁用");

      const targetCanAccess =
        target.role === "ADMIN" ||
        (target.tenantId === conversation.site.tenantId &&
          (target.role === "MERCHANT_ADMIN" ||
            target.sites.some((site) => site.siteId === conversation.siteId)));
      if (!targetCanAccess) {
        throw new HttpError(400, "目标客服没有该站点的权限");
      }
      if (
        target.id === conversation.assignedAgentId &&
        conversation.status === "OPEN"
      )
        return null;
      return {
        data: {
          assignedAgentId: target.id,
          status: "OPEN",
          closedAt: null,
          closedById: null,
        },
        body: `会话已由 ${user.name} 转交给 ${target.name}`,
      };
    },
    (conversation, tx) =>
      conversation.assignedAgent
        ? notifyConversationAssigned(
            { conversation, agentName: conversation.assignedAgent.name },
            tx,
          )
        : Promise.resolve(),
  );
  return result.conversation;
}

export async function closeConversation(
  user: SessionUser,
  conversationId: string,
): Promise<SerializedConversation> {
  const result = await transitionConversation(
    user,
    conversationId,
    async (current) => {
      if (current.status === "CLOSED") return null;
      return {
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closedById: user.id,
          unreadForAgent: 0,
          waitingSince: null,
          waitingMessageId: null,
        },
        body: `会话已被 ${user.name} 结束`,
      };
    },
    (conversation, tx) =>
      notifyConversationClosed(
        {
          conversationId,
          siteId: conversation.siteId,
          siteName: conversation.siteName,
          visitorEmail: conversation.visitor.email,
          agentName: user.name,
        },
        tx,
      ),
  );

  return result.conversation;
}

export async function reopenConversation(
  user: SessionUser,
  conversationId: string,
): Promise<SerializedConversation> {
  const result = await transitionConversation(
    user,
    conversationId,
    async (current) => {
      if (current.status !== "CLOSED") {
        if (current.status === "OPEN" && current.assignedAgentId === user.id)
          return null;
        throw new HttpError(409, "会话状态已变化，请刷新后重试");
      }
      return {
        data: {
          status: "OPEN",
          closedAt: null,
          closedById: null,
          assignedAgentId: user.id,
        },
        body: `会话已被 ${user.name} 重新打开`,
      };
    },
  );
  return result.conversation;
}

/** 访客档案 + 历史会话，供工作台右侧面板展示 */
