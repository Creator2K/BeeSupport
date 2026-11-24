import type { Server } from "socket.io";
import { createHash } from "node:crypto";

import type {
  AgentPresenceStatus,
  SerializedConversation,
  SerializedMessage,
} from "./types";
import { prisma } from "../db";
import { logger } from "../logger";
import { rooms } from "./rooms";
import { visitorConversation, visitorMessage } from "./public";

/**
 * 广播桥。
 *
 * 自定义 server 启动时把 Socket.IO 实例挂到 globalThis；
 * Next 的 Route Handler 与它在同一个 Node 进程里，因此可以直接复用，
 * 多实例部署时再由 @socket.io/redis-adapter 把事件转发到其它实例。
 */
type RealtimeGlobal = typeof globalThis & { __beeIo?: Server };

export function setIo(io: Server): void {
  (globalThis as RealtimeGlobal).__beeIo = io;
}

export function getIo(): Server | null {
  return (globalThis as RealtimeGlobal).__beeIo ?? null;
}

function emit(room: string | string[], event: string, payload: unknown): void {
  const io = getIo();
  if (!io) return; // 例如用 `next dev` 裸跑时没有实时通道，前端会走轮询兜底
  io.to(room).emit(event, payload);
}

export function emitMessage(payload: {
  conversationId: string;
  message: SerializedMessage;
  conversation: SerializedConversation;
}, event: "message:new" | "message:deleted" = "message:new"): void {
  // 会话房间（客服工作台已打开该会话）+ 访客个人房间（访客端无需依赖 join 时机）
  emit(
    [
      rooms.siteAgents(payload.conversation.siteId),
      rooms.tenantAdmins(payload.conversation.tenantId ?? "legacy"),
      rooms.admins(),
    ],
    event,
    payload,
  );
  // 内部备注只给客服看，不能推给访客房间
  if (payload.message.type !== "NOTE") {
    emit(rooms.visitor(payload.conversation.visitor.id), event, {
      conversationId: payload.conversationId,
      message: visitorMessage(payload.message),
      conversation: visitorConversation(payload.conversation),
    });
  }
}

export function emitConversationCreated(
  conversation: SerializedConversation,
): void {
  // 只发给对该站点有权限的客服，避免跨站点数据泄漏
  emit(
    [
      rooms.siteAgents(conversation.siteId),
      rooms.tenantAdmins(conversation.tenantId ?? "legacy"),
      rooms.admins(),
    ],
    "conversation:created",
    {
      conversation,
    },
  );
  emit(rooms.visitor(conversation.visitor.id), "conversation:created", {
    conversation: visitorConversation(conversation),
  });
}

export function emitConversationUpdated(
  conversation: SerializedConversation,
  extraRooms: string[] = [],
): void {
  const targets = new Set([
    rooms.siteAgents(conversation.siteId),
    rooms.tenantAdmins(conversation.tenantId ?? "legacy"),
    rooms.admins(),
    ...extraRooms,
  ]);
  emit([...targets], "conversation:updated", { conversation });
  emit(rooms.visitor(conversation.visitor.id), "conversation:updated", {
    conversation: visitorConversation(conversation),
  });
}

export function emitTyping(payload: {
  conversationId: string;
  from: "VISITOR" | "AGENT";
  isTyping: boolean;
  name?: string;
  visitorId?: string;
}): void {
  emit(rooms.conversation(payload.conversationId), "typing", payload);
  if (payload.visitorId) {
    emit(rooms.visitor(payload.visitorId), "typing", payload);
  }
}

export function emitRead(payload: {
  conversationId: string;
  by: "VISITOR" | "AGENT";
  visitorId?: string;
}): void {
  emit(
    rooms.conversation(payload.conversationId),
    "conversation:read",
    payload,
  );
  if (payload.visitorId) {
    emit(rooms.visitor(payload.visitorId), "conversation:read", payload);
  }
}

export function emitAgentPresence(
  userId: string,
  status: AgentPresenceStatus,
): void {
  void prisma.user
    .findUnique({ where: { id: userId }, select: { tenantId: true } })
    .then((user) => {
      if (user)
        emit(
          [rooms.tenantAgents(user.tenantId), rooms.allAgents()],
          "presence:agent",
          { userId, status },
        );
    })
    .catch((error: unknown) =>
      logger.error("realtime.agent_presence_failed", { userId }, error),
    );
}

export function emitVisitorPresence(visitorId: string, online: boolean): void {
  emit(rooms.visitor(visitorId), "presence:visitor", { visitorId, online });
  void prisma.visitor
    .findUnique({
      where: { id: visitorId },
      select: { siteId: true, site: { select: { tenantId: true } } },
    })
    .then((visitor) => {
      if (visitor)
        emit(
          [
            rooms.siteAgents(visitor.siteId),
            rooms.tenantAdmins(visitor.site.tenantId),
            rooms.admins(),
          ],
          "presence:visitor",
          { visitorId, online },
        );
    })
    .catch((error: unknown) =>
      logger.error("realtime.visitor_presence_failed", { visitorId }, error),
    );
}

/** 通知具体某个客服（新会话指派、转接提醒等） */
export function emitToAgent(
  userId: string,
  event: string,
  payload: unknown,
): void {
  emit(rooms.agent(userId), event, payload);
}

/** Redis adapter forwards the disconnect to every application instance. */
export function revokeAgentConnections(userId: string): void {
  const io = getIo();
  io?.to(rooms.agent(userId)).emit("session:revoked");
  io?.in(rooms.agent(userId)).disconnectSockets(true);
}

export function agentSessionRoom(token: string): string {
  return `session:${createHash("sha256").update(token).digest("hex")}`;
}

export function disconnectSession(token: string): void {
  getIo()?.in(agentSessionRoom(token)).disconnectSockets(true);
}
