/** Test resources must be cleaned up even if provisioning or the first assertion fails. */
export function createTestResources() {
  const cleanups = [];
  return {
    add(cleanup) {
      cleanups.push(cleanup);
    },
    async close() {
      const errors = [];
      while (cleanups.length) {
        try {
          await cleanups.pop()();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, "测试资源清理失败");
    },
  };
}

export function listenTestServer(server) {
  return new Promise((resolve, reject) => {
    const failed = (error) => {
      server.off("error", failed);
      reject(error);
    };
    server.once("error", failed);
    try {
      server.listen(0, "0.0.0.0", () => {
        server.off("error", failed);
        resolve(server.address().port);
      });
    } catch (error) {
      failed(error);
    }
  });
}

export async function closeTestServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) =>
      error && error.code !== "ERR_SERVER_NOT_RUNNING"
        ? reject(error)
        : resolve(),
    );
    server.closeAllConnections?.();
  });
}

export function waitFor(socket, event, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off(event, received);
      socket.off("disconnect", disconnected);
    };
    const received = (payload) => {
      cleanup();
      resolve(payload);
    };
    const disconnected = () => {
      cleanup();
      reject(new Error(`等待事件 ${event} 时连接断开`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`等待事件 ${event} 超时`));
    }, timeoutMs);
    socket.once(event, received);
    socket.once("disconnect", disconnected);
  });
}

/** Transport connect happens before authenticated rooms are ready on the server. */
export function connectSocket(createSocket, url, options, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const socket = createSocket(url, {
      ...options,
      path: "/socket.io",
      transports: ["websocket"],
      autoConnect: false,
      reconnection: false,
    });
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("session:ready", ready);
      socket.off("connect_error", failed);
      socket.off("disconnect", disconnected);
      socket.off("session:revoked", revoked);
    };
    const ready = () => {
      cleanup();
      resolve(socket);
    };
    const failed = (error) => {
      cleanup();
      socket.close();
      reject(error);
    };
    const disconnected = () => failed(new Error("Socket 就绪前连接断开"));
    const revoked = () => failed(new Error("Socket 身份已失效"));
    const timer = setTimeout(
      () => failed(new Error("Socket 就绪超时")),
      timeoutMs,
    );
    socket.once("session:ready", ready);
    socket.once("connect_error", failed);
    socket.once("disconnect", disconnected);
    socket.once("session:revoked", revoked);
    try {
      socket.connect();
    } catch (error) {
      failed(error);
    }
  });
}
