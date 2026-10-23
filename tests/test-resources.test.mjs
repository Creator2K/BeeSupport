import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  closeTestServer,
  connectSocket,
  createTestResources,
  listenTestServer,
  waitFor,
} from "../scripts/realtime-test-helpers.mjs";

class Socket extends EventEmitter {
  closed = 0;
  connect() {
    this.emit("connect");
  }
  close() {
    this.closed += 1;
    this.emit("disconnect");
  }
}

test("transport connection is insufficient until session rooms are ready", async () => {
  const socket = new Socket();
  let connected = false;
  const pending = connectSocket(
    (_url, options) => {
      assert.equal(options.autoConnect, false);
      assert.equal(options.reconnection, false);
      return socket;
    },
    "http://test",
    {},
  ).then((value) => {
    connected = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(connected, false);
  socket.emit("session:ready");
  assert.equal(await pending, socket);
  assert.equal(socket.eventNames().length, 0);
  assert.equal(socket.closed, 0);
});

test("connection rejection and revocation close sockets and remove listeners", async () => {
  for (const event of ["connect_error", "session:revoked", "disconnect"]) {
    const socket = new Socket();
    const pending = connectSocket(() => socket, "http://test", {});
    socket.emit(event, new Error("denied"));
    await assert.rejects(pending);
    assert.equal(socket.closed, 1);
    assert.equal(socket.eventNames().length, 0);
  }
});

test("a server that never becomes ready cannot leak a retrying socket", async () => {
  const socket = new Socket();
  await assert.rejects(
    connectSocket(() => socket, "http://test", {}, 20),
    /超时/,
  );
  assert.equal(socket.closed, 1);
  assert.equal(socket.eventNames().length, 0);
});

test("event timeout and disconnect remove their listeners", async () => {
  const socket = new Socket();
  await assert.rejects(waitFor(socket, "message:new", 20), /超时/);
  assert.equal(socket.eventNames().length, 0);
  const pending = waitFor(socket, "message:new");
  socket.emit("disconnect");
  await assert.rejects(pending, /断开/);
  assert.equal(socket.eventNames().length, 0);
});

test("cleanup still closes remaining resources after an earlier cleanup fails", async () => {
  const resources = createTestResources();
  const closed = [];
  resources.add(async () => {
    closed.push("database");
  });
  resources.add(async () => {
    closed.push("site");
    throw new Error("site deletion failed");
  });
  resources.add(async () => {
    closed.push("socket");
  });
  await assert.rejects(resources.close(), AggregateError);
  assert.deepEqual(closed, ["socket", "site", "database"]);
  await resources.close();
  assert.equal(closed.length, 3);
});

test("mock server listen errors reject provisioning without leaving an error listener", async () => {
  const server = new EventEmitter();
  server.listen = () => {
    server.emit("error", new Error("address unavailable"));
  };
  await assert.rejects(listenTestServer(server), /address unavailable/);
  assert.equal(server.listenerCount("error"), 0);
});

test("mock server cleanup closes active requests and tolerates repeated cleanup", async () => {
  const order = [];
  let finish;
  const server = {
    listening: true,
    close(callback) {
      order.push("stop accepting");
      finish = callback;
    },
    closeAllConnections() {
      order.push("close requests");
      server.listening = false;
      finish();
    },
  };
  await closeTestServer(server);
  await closeTestServer(server);
  assert.deepEqual(order, ["stop accepting", "close requests"]);
});
