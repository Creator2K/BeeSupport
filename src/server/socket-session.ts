import type { Socket } from "socket.io";

import { createTtlCache } from "./ttl-cache";
import {
  SOCKET_CONVERSATION_TTL_MS,
  SOCKET_IDENTITY_TTL_MS,
  authenticate,
  type ConversationAccess,
  type Identity,
} from "./socket-auth";

export function createSocketSession(socket: Socket, identity: Identity) {
  const identityCache = createTtlCache<string, Identity>({
    ttlMs: SOCKET_IDENTITY_TTL_MS,
    maxEntries: 1,
  });
  identityCache.set("identity", identity);
  const conversationCache = createTtlCache<
    string,
    ConversationAccess | null
  >({
    ttlMs: SOCKET_CONVERSATION_TTL_MS,
    maxEntries: 128,
  });
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
  const refreshIdentity = async (force = false) => {
    const fresh = await identityCache.getOrLoad(
      "identity",
      () => authenticate(socket),
      force,
    );
    if ((!fresh.user && !fresh.visitor) || fingerprint(fresh) !== original) {
      conversationCache.clear();
      socket.emit("session:revoked");
      socket.disconnect(true);
      throw new Error("Session revoked");
    }
    socket.data.identity = fresh;
    return fresh;
  };
  // Every event reuses a short-lived identity snapshot. Privilege-changing
  // actions actively disconnect sockets, so the TTL only bounds passive drift.
  socket.use((_packet, next) => {
    void refreshIdentity()
      .then(() => next())
      .catch(() => next(new Error("Unauthorized")));
  });

  // Register handlers synchronously: clients may join immediately after connect.

  return {
    identityCache,
    conversationCache,
    refreshIdentity,
  };
}
