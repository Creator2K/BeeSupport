import type { Server, Socket } from "socket.io";

import {
  SESSION_COOKIE,
  canAccessSite,
  resolveUserFromToken,
  type SessionUser,
} from "../lib/auth";
import { prisma } from "../lib/db";
import {
  agentSessionRoom,
  emitAgentPresence,
  emitTyping,
  emitVisitorPresence,
  setIo,
} from "../lib/realtime/emit";
import { rooms } from "../lib/realtime/rooms";
import { verifyVisitorToken, type VisitorSession } from "../lib/visitor-auth";
import { createClientIpResolver } from "./client-ip";
import { assertIpAllowed } from "./services/risk";
import { rateLimit } from "../lib/rate-limit";
import {
  addAgentSocket,
  markVisitorOnline,
  removeAgentSocket,
  markVisitorOffline,
} from "./presence";

const resolveSocketIp = createClientIpResolver(process.env.TRUSTED_PROXY_CIDRS);

type Identity = { user: SessionUser | null; visitor: VisitorSession | null };
type EventPayload = {
  conversationId?: unknown;
  isTyping?: unknown;
  status?: unknown;
};

async function authenticate(socket: Socket): Promise<Identity> {
  const token = (socket.handshake.auth as { token?: string } | undefined)
    ?.token;
  if (token) {
    const visitor = await verifyVisitorToken(token);
    if (visitor) {
      const forwarded = socket.handshake.headers["x-forwarded-for"];
      const ip = resolveSocketIp(
        socket.request.socket.remoteAddress,
        typeof forwarded === "string" ? forwarded : undefined,
      );
      socket.data.clientIp = ip;
      await assertIpAllowed({ ...visitor, ip, context: "socket" }, false);
    }
    return { user: null, visitor };
  }
  return {
    user: await resolveUserFromToken(
      parseCookie(socket.handshake.headers.cookie, SESSION_COOKIE),
    ),
    visitor: null,
  };
}

export function registerRealtime(io: Server): void {
  setIo(io);
  io.use((socket, next) => {
    void authenticate(socket)
      .then((identity) => {
        if (!identity.user && !identity.visitor)
          return next(new Error("Unauthorized"));
        socket.data.identity = identity;
        next();
      })
      .catch(() => next(new Error("Unauthorized")));
  });

  io.on("connection", (socket) => {
    const identity = socket.data.identity as Identity;
    const fingerprint = (value: Identity) =>
      JSON.stringify([
        value.user?.id,
        value.user?.role,
        value.user?.tenantId,
        value.user?.role !== "MERCHANT_ADMIN" && value.user?.siteIds
          ? [...value.user.siteIds].sort()
          : null,
        value.visitor?.visitorId,
      ]);
    const original = fingerprint(identity);
    const refreshIdentity = async () => {
      const fresh = await authenticate(socket);
      if ((!fresh.user && !fresh.visitor) || fingerprint(fresh) !== original) {
        socket.emit("session:revoked");
        socket.disconnect(true);
        throw new Error("Session revoked");
      }
      socket.data.identity = fresh;
      return fresh;
    };
    // Validate expiry and revocation for every incoming event, including typing.
    socket.use((_packet, next) => {
      void refreshIdentity()
        .then(() => next())
        .catch(() => next(new Error("Unauthorized")));
    });

    // Register handlers synchronously: clients may join immediately after connect.
    const initialized = (async () => {
      if (identity.user) {
        await socket.join([
          rooms.agent(identity.user.id),
          identity.user.role === "ADMIN"
            ? rooms.allAgents()
            : rooms.tenantAgents(identity.user.tenantId),
          agentSessionRoom(
            parseCookie(socket.handshake.headers.cookie, SESSION_COOKIE)!,
          ),
        ]);
        // Administrators receive every site's events, including sites created later.
        await socket.join(
          identity.user.siteIds === null
            ? rooms.admins()
            : identity.user.siteIds.map(rooms.siteAgents),
        );
        if (identity.user.role === "MERCHANT_ADMIN")
          await socket.join(rooms.tenantAdmins(identity.user.tenantId));
        await addAgentSocket(identity.user.id, socket.id);
        const updated = await prisma.user.update({
          where: { id: identity.user.id },
          data: {
            lastSeenAt: new Date(),
            status:
              identity.user.status === "OFFLINE"
                ? "ONLINE"
                : identity.user.status,
          },
          select: { status: true },
        });
        emitAgentPresence(identity.user.id, updated.status);
      }
      if (identity.visitor) {
        await socket.join(rooms.visitor(identity.visitor.visitorId));
        await markVisitorOnline(identity.visitor.visitorId);
        emitVisitorPresence(identity.visitor.visitorId, true);
      }
      // Recheck after asynchronous initialization in case revocation raced the handshake.
      await refreshIdentity();
      socket.emit("session:ready");
    })();
    void initialized.catch((error: unknown) => {
      console.error("[realtime] 初始化失败:", error);
      socket.disconnect(true);
    });

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
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true, siteId: true, visitorId: true },
      });
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
        .then(refreshIdentity)
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
  });
}

function parseCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}
