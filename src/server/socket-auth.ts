import type { Socket } from "socket.io";

import {
  SESSION_COOKIE,
  resolveUserFromToken,
  type SessionUser,
} from "../lib/auth";
import { verifyVisitorToken, type VisitorSession } from "../lib/visitor-auth";
import { createClientIpResolver } from "./client-ip";
import { assertIpAllowed } from "./services/risk";

const resolveSocketIp = createClientIpResolver(process.env.TRUSTED_PROXY_CIDRS);

export type Identity = { user: SessionUser | null; visitor: VisitorSession | null };
export type EventPayload = {
  conversationId?: unknown;
  isTyping?: unknown;
  status?: unknown;
};
export type ConversationAccess = {
  id: string;
  siteId: string;
  visitorId: string;
};

function ttlFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0
    ? Math.min(value, 60_000)
    : fallback;
}

export const SOCKET_IDENTITY_TTL_MS = ttlFromEnv("SOCKET_IDENTITY_TTL_MS", 5_000);
export const SOCKET_CONVERSATION_TTL_MS = ttlFromEnv(
  "SOCKET_CONVERSATION_TTL_MS",
  5_000,
);

export async function authenticate(socket: Socket): Promise<Identity> {
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
      // 封禁地址时服务端会主动断开连接，客户端随即重连；多实例部署时这次重连可能落到
      // 规则缓存还没过期的实例上，所以握手和身份复查不读缓存
      await assertIpAllowed({ ...visitor, ip, context: "socket" }, false, {
        fresh: true,
      });
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

export function parseCookie(header: string | undefined, name: string): string | null {
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
