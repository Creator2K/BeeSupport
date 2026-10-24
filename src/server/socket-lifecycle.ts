import type { Socket } from "socket.io";

import {
  agentSessionRoom,
  emitAgentPresence,
  emitVisitorPresence,
} from "../lib/realtime/emit";
import { rooms } from "../lib/realtime/rooms";
import { prisma } from "../lib/db";
import { addAgentSocket, markVisitorOnline } from "./presence";
import {
  parseCookie,
  type Identity,
} from "./socket-auth";
import { SESSION_COOKIE } from "../lib/auth";

export async function initializeSocketConnection(
  socket: Socket,
  identity: Identity,
  refreshIdentity: (force?: boolean) => Promise<Identity>,
): Promise<void> {

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
  // Force one DB-backed validation after asynchronous initialization.
  await refreshIdentity(true);
  socket.emit("session:ready");
}
