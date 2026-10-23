"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { SOCKET_PATH } from "./types";

/**
 * 与服务端 Socket.IO 建立连接。
 * 客服端靠 httpOnly cookie 自动认证；访客端用 auth.token 显式带上访客令牌。
 */
export function useSocket(options?: {
  auth?: Record<string, unknown>;
  enabled?: boolean;
}): { socket: Socket | null; connected: boolean } {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const authRef = useRef(options?.auth);
  authRef.current = options?.auth;

  const enabled = options?.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;

    const instance = io({
      path: SOCKET_PATH,
      withCredentials: true,
      transports: ["websocket", "polling"],
      auth: (callback) => callback(authRef.current ?? {}),
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });

    instance.on("connect", () => setConnected(false));
    instance.on("session:ready", () => setConnected(true));
    instance.on("disconnect", () => setConnected(false));
    instance.on("connect_error", () => setConnected(false));

    setSocket(instance);

    return () => {
      instance.removeAllListeners();
      instance.close();
      setSocket(null);
      setConnected(false);
    };
  }, [enabled]);

  return { socket, connected };
}
