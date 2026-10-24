import type { Server } from "socket.io";

import { setIo } from "../lib/realtime/emit";
import { authenticate, type Identity } from "./socket-auth";
import { initializeSocketConnection } from "./socket-lifecycle";
import { createSocketSession } from "./socket-session";
import { registerSocketEvents } from "./socket-events";

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
    const session = createSocketSession(socket, identity);
    const initialized = initializeSocketConnection(
      socket,
      identity,
      session.refreshIdentity,
    );
    void initialized.catch((error: unknown) => {
      console.error("[realtime] ?????:", error);
      socket.disconnect(true);
    });
    registerSocketEvents({ io, socket, identity, initialized, session });
  });
}
