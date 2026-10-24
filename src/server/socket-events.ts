import type { Server, Socket } from "socket.io";

import { canAccessSite } from "../lib/auth";
import { rateLimit } from "../lib/rate-limit";
import { prisma } from "../lib/db";
import {
  emitAgentPresence,
  emitTyping,
  emitVisitorPresence,
} from "../lib/realtime/emit";
import { rooms } from "../lib/realtime/rooms";
import {
  addAgentSocket,
  markVisitorOffline,
  markVisitorOnline,
  removeAgentSocket,
} from "./presence";
import type { EventPayload, Identity } from "./socket-auth";
import type { createSocketSession } from "./socket-session";

export function registerSocketEvents({
  io,
  socket,
  identity,
  initialized,
  session,
}: {
  io: Server;
  socket: Socket;
  identity: Identity;
  initialized: Promise<void>;
  session: ReturnType<typeof createSocketSession>;
}) {
  const { identityCache, conversationCache, refreshIdentity } = session;

  const handle = (
    event: string,
    callback: (
      payload: EventPayload | undefined,
      ack?: (result: { ok: boolean; error?: string }) => void,
    ) => Promise<void>,
  ) => {
    socket.on(event, (payload, ack) => {
      void initialized
        .then(() =>
          callback(payload, typeof ack === "function" ? ack : undefined),
        )
        .catch((error: unknown) => {
          console.error(`[realtime] ${event} 失败:`, error);
          if (typeof ack === "function")
            ack({ ok: false, error: "无法完成操作" });
        });
    });
  };
  const accessibleConversation = async (conversationId: unknown) => {
    if (
      typeof conversationId !== "string" ||
      !conversationId ||
      conversationId.length > 128
    )
      return null;
    const conversation = await conversationCache.getOrLoad(
      conversationId,
      () =>
        prisma.conversation.findUnique({
          where: { id: conversationId },
          select: { id: true, siteId: true, visitorId: true },
        }),
    );
    if (!conversation) return null;
    const current = socket.data.identity as Identity;
    return (current.user &&
      canAccessSite(current.user, conversation.siteId)) ||
      (current.visitor &&
        current.visitor.visitorId === conversation.visitorId &&
        current.visitor.siteId === conversation.siteId)
      ? conversation
      : null;
  };

  handle("conversation:join", async (payload, ack) => {
    const conversation = await accessibleConversation(
      payload?.conversationId,
    );
    if (!conversation) {
      ack?.({ ok: false, error: "无权访问该会话" });
      return;
    }
    if ((socket.data.identity as Identity).user)
      await socket.join(rooms.conversation(conversation.id));
    ack?.({ ok: true });
  });
  handle("conversation:leave", async (payload) => {
    if (typeof payload?.conversationId === "string")
      await socket.leave(rooms.conversation(payload.conversationId));
  });
  handle("typing", async (payload) => {
    if (!(await rateLimit(`typing:${socket.id}`, 10, 5)).ok) return;
    const conversation = await accessibleConversation(
      payload?.conversationId,
    );
    if (!conversation) return;
    const current = socket.data.identity as Identity;
    emitTyping({
      conversationId: conversation.id,
      from: current.user ? "AGENT" : "VISITOR",
      isTyping: Boolean(payload?.isTyping),
      name: current.user?.name,
      visitorId: conversation.visitorId,
    });
  });
  handle("agent:status", async (payload) => {
    const current = socket.data.identity as Identity;
    const status = payload?.status;
    if (
      !current.user ||
      (status !== "ONLINE" && status !== "AWAY" && status !== "OFFLINE")
    )
      return;
    await prisma.user.update({
      where: { id: current.user.id },
      data: { status, lastSeenAt: new Date() },
    });
    emitAgentPresence(current.user.id, status);
  });
  handle("visitor:ping", async () => {
    const current = socket.data.identity as Identity;
    if (current.visitor) await markVisitorOnline(current.visitor.visitorId);
  });

  let renewing = false;
  const timer = setInterval(() => {
    if (renewing) return;
    renewing = true;
    void initialized
      .then(() => refreshIdentity(true))
      .then(async (current) => {
        if (!socket.connected) return;
        if (current.user) {
          await addAgentSocket(current.user.id, socket.id);
          await prisma.user.update({
            where: { id: current.user.id },
            data: { lastSeenAt: new Date() },
          });
        }
      })
      .catch(() => socket.disconnect(true))
      .finally(() => {
        renewing = false;
      });
  }, 30_000);
  timer.unref();

  socket.on("disconnect", () => {
    clearInterval(timer);
    identityCache.clear();
    conversationCache.clear();
    void initialized
      .catch(() => undefined)
      .then(async () => {
        if (identity.user) {
          const remaining = await removeAgentSocket(
            identity.user.id,
            socket.id,
          );
          if (remaining === 0) {
            await prisma.user.updateMany({
              where: { id: identity.user.id },
              data: { status: "OFFLINE", lastSeenAt: new Date() },
            });
            emitAgentPresence(identity.user.id, "OFFLINE");
          }
        }
        if (
          identity.visitor &&
          (
            await io
              .in(rooms.visitor(identity.visitor.visitorId))
              .fetchSockets()
          ).length === 0
        ) {
          await markVisitorOffline(identity.visitor.visitorId);
          emitVisitorPresence(identity.visitor.visitorId, false);
        }
      })
      .catch((error: unknown) =>
        console.error("[realtime] 断开连接清理失败:", error),
      );
  });
}
