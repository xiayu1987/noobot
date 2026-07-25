/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { DownstreamConnectionRegistry } from "../src/downstream-connection-registry.js";
import { UpstreamTransportSupervisor } from "../src/upstream-transport-supervisor.js";

class FakeWebSocket extends EventEmitter {
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    FakeWebSocket.instances.push(this);
  }
  send() {}
  close(code, reason) {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", code, reason);
  }
}

test("upstream supervisor ignores close callbacks from a replaced generation", () => {
  FakeWebSocket.instances = [];
  const supervisor = new UpstreamTransportSupervisor(FakeWebSocket);
  const first = supervisor.connect("ws://first");
  const second = supervisor.connect("ws://second");

  first.socket.emit("close", 1006, "late");

  assert.equal(supervisor.socket, second.socket);
  assert.equal(supervisor.status().generation, second.generation);
  assert.equal(supervisor.status().phase, "connecting");
});

test("downstream registry finalizes error and close only once", () => {
  let finalized = 0;
  const socket = { __agentProxySocketId: "connection-1" };
  const registry = new DownstreamConnectionRegistry();
  registry.register(socket, { onFinalize: () => { finalized += 1; } });

  assert.equal(registry.finalize(socket, "error"), true);
  assert.equal(registry.finalize(socket, "close"), false);
  assert.equal(finalized, 1);
  assert.equal(registry.size, 0);
});

test("downstream registry owns graceful physical close and finalization", () => {
  let finalizedReason = "";
  const socket = {
    __agentProxySocketId: "connection-close",
    closeCalls: [],
    close(code, reason) { this.closeCalls.push({ code, reason }); },
  };
  const registry = new DownstreamConnectionRegistry();
  registry.register(socket, { onFinalize: (record) => { finalizedReason = record.finalizeReason; } });

  assert.equal(registry.close(socket, { code: 1001, reason: "heartbeat_timeout" }), true);
  assert.deepEqual(socket.closeCalls, [{ code: 1001, reason: "heartbeat_timeout" }]);
  assert.equal(finalizedReason, "heartbeat_timeout");
  assert.equal(registry.size, 0);
  assert.equal(registry.close(socket), false);
});

test("downstream registry terminates errored physical sockets before finalization", () => {
  let terminated = 0;
  const socket = {
    __agentProxySocketId: "connection-error",
    terminate() { terminated += 1; },
  };
  const registry = new DownstreamConnectionRegistry();
  registry.register(socket);

  assert.equal(registry.close(socket, { terminate: true, finalizeReason: "error" }), true);
  assert.equal(terminated, 1);
  assert.equal(registry.size, 0);
});

test("upstream supervisor reports constructor failures without corrupting ownership", () => {
  class ThrowingWebSocket {
    static OPEN = 1;
    static CLOSED = 3;
    constructor() { throw Object.assign(new Error("invalid upstream url"), { code: "ERR_INVALID_URL" }); }
  }
  const errors = [];
  const supervisor = new UpstreamTransportSupervisor(ThrowingWebSocket);

  assert.equal(supervisor.connect("invalid", { error: (event) => errors.push(event) }), null);
  assert.equal(supervisor.status().generation, 0);
  assert.equal(supervisor.status().phase, "idle");
  assert.equal(supervisor.status().hasSocket, false);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].error.code, "ERR_INVALID_URL");
});

test("upstream supervisor emits one local close transition and ignores the stale socket callback", () => {
  const closed = [];
  const supervisor = new UpstreamTransportSupervisor(FakeWebSocket);
  const connection = supervisor.connect("ws://upstream", {
    close: (event) => closed.push(event),
  });

  assert.equal(supervisor.close(1001, "heartbeat_timeout"), true);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].socket, connection.socket);
  assert.equal(closed[0].locallyInitiated, true);
  assert.equal(closed[0].reason, "heartbeat_timeout");
  assert.equal(supervisor.status().phase, "idle");
});

test("upstream supervisor contains open-handler failures and closes the failed generation", () => {
  const handlerErrors = [];
  const closed = [];
  const supervisor = new UpstreamTransportSupervisor(FakeWebSocket);
  const connection = supervisor.connect("ws://upstream", {
    open() { throw new TypeError("open handler failed"); },
    handlerError: (event) => handlerErrors.push(event),
    close: (event) => closed.push(event),
  });

  assert.doesNotThrow(() => connection.socket.emit("open"));
  assert.equal(handlerErrors.length, 1);
  assert.equal(handlerErrors[0].handlerName, "open");
  assert.equal(closed.length, 1);
  assert.equal(closed[0].reason, "handler_failure");
  assert.equal(supervisor.status().hasSocket, false);
});

test("upstream supervisor contains close-handler failures", () => {
  const handlerErrors = [];
  const supervisor = new UpstreamTransportSupervisor(FakeWebSocket);
  const connection = supervisor.connect("ws://upstream", {
    close() { throw new Error("close handler failed"); },
    handlerError: (event) => handlerErrors.push(event),
  });

  assert.doesNotThrow(() => connection.socket.emit("close", 1006, "network"));
  assert.equal(handlerErrors.length, 1);
  assert.equal(handlerErrors[0].handlerName, "close");
  assert.equal(supervisor.status().phase, "idle");
});

test("downstream heartbeat closes only records that missed pong", () => {
  let currentMs = 0;
  const timedOut = [];
  const socket = { __agentProxySocketId: "connection-heartbeat", ping() {} };
  const registry = new DownstreamConnectionRegistry({ now: () => currentMs });
  registry.register(socket);
  registry.sweepHeartbeat({ timeoutMs: 100, onTimeout: (record) => timedOut.push(record.connectionId) });
  currentMs = 100;
  registry.sweepHeartbeat({ timeoutMs: 100, onTimeout: (record) => timedOut.push(record.connectionId) });
  assert.deepEqual(timedOut, ["connection-heartbeat"]);
});
