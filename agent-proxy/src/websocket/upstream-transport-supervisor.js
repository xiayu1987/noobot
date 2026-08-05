/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const UPSTREAM_TRANSPORT_PHASE = Object.freeze({
  IDLE: "idle",
  CONNECTING: "connecting",
  OPEN: "open",
  DISPOSED: "disposed",
});

export class UpstreamTransportSupervisor {
  constructor(WebSocketImpl, { closeGraceMs = 2000 } = {}) {
    this.WebSocket = WebSocketImpl;
    this.closeGraceMs = Math.max(0, Number(closeGraceMs) || 0);
    this.socket = null;
    this.retiredSockets = new Map();
    this.generation = 0;
    this.phase = UPSTREAM_TRANSPORT_PHASE.IDLE;
    this.everConnected = false;
    this.lastSeenAtMs = 0;
    this.awaitingPong = false;
    this.handlers = null;
    this.purpose = "";
  }

  connect(url, handlers = {}, { purpose = "run" } = {}) {
    if (this.phase === UPSTREAM_TRANSPORT_PHASE.DISPOSED) return null;
    const previousSocket = this.socket;
    let socket = null;
    try {
      socket = new this.WebSocket(url);
    } catch (error) {
      this.invokeHandler(handlers, "error", { socket: null, generation: this.generation, error });
      return null;
    }
    if (previousSocket) this._retireSocket(previousSocket, 1000, "replaced");
    const generation = ++this.generation;
    this.socket = socket;
    this.handlers = handlers;
    this.purpose = String(purpose || "").trim() || "run";
    this.phase = UPSTREAM_TRANSPORT_PHASE.CONNECTING;
    this.everConnected = true;
    this.lastSeenAtMs = Date.now();
    this.awaitingPong = false;
    socket.on("open", () => {
      if (!this.isCurrent(socket, generation)) return;
      this.phase = UPSTREAM_TRANSPORT_PHASE.OPEN;
      if (!this.invokeHandler(handlers, "open", { socket, generation })) {
        this.close(1011, "handler_failure");
      }
    });
    socket.on("message", (rawData) => {
      if (!this.isCurrent(socket, generation)) return;
      this.touch();
      if (!this.invokeHandler(handlers, "message", { socket, generation, rawData })) {
        this.close(1011, "handler_failure");
      }
    });
    socket.on("pong", () => {
      if (this.isCurrent(socket, generation)) this.touch();
    });
    socket.on("error", (error) => {
      if (!this.isCurrent(socket, generation)) return;
      if (!this.invokeHandler(handlers, "error", { socket, generation, error })) {
        this.close(1011, "handler_failure");
      }
    });
    socket.on("close", (code, reason) => {
      this._releaseRetiredSocket(socket);
      if (!this.isCurrent(socket, generation)) return;
      this.socket = null;
      this.phase = UPSTREAM_TRANSPORT_PHASE.IDLE;
      this.handlers = null;
      this.purpose = "";
      this.invokeHandler(handlers, "close", { socket, generation, code, reason });
    });
    return { socket, generation, previousSocket };
  }

  claimPurpose(purpose = "run") {
    if (!this.socket || this.phase === UPSTREAM_TRANSPORT_PHASE.DISPOSED) return false;
    this.purpose = String(purpose || "").trim() || "run";
    return true;
  }

  closeOwnedConnection(connection = null, code = 1000, reason = "closed", { purpose = "" } = {}) {
    if (!connection || !this.isCurrent(connection.socket, connection.generation)) return false;
    const requiredPurpose = String(purpose || "").trim();
    if (requiredPurpose && this.purpose !== requiredPurpose) return false;
    return this.close(code, reason);
  }

  adopt(socket) {
    if (this.phase === UPSTREAM_TRANSPORT_PHASE.DISPOSED) return false;
    if (this.socket && this.socket !== socket) {
      this._retireSocket(this.socket, 1000, "replaced");
    }
    this.generation += 1;
    this.socket = socket || null;
    this.handlers = null;
    this.purpose = socket ? "run" : "";
    this.phase = !socket
      ? UPSTREAM_TRANSPORT_PHASE.IDLE
      : socket.readyState === this.WebSocket.OPEN
        ? UPSTREAM_TRANSPORT_PHASE.OPEN
        : UPSTREAM_TRANSPORT_PHASE.CONNECTING;
    if (socket) this.everConnected = true;
    return true;
  }

  isCurrent(socket, generation = this.generation) {
    return Boolean(socket && socket === this.socket && generation === this.generation && this.phase !== UPSTREAM_TRANSPORT_PHASE.DISPOSED);
  }

  invokeHandler(handlers, handlerName, event) {
    try {
      handlers?.[handlerName]?.(event);
      return true;
    } catch (error) {
      try {
        handlers?.handlerError?.({
          ...event,
          handlerName,
          error,
        });
      } catch {}
      return false;
    }
  }

  send(payload) {
    if (!this.socket || this.socket.readyState !== this.WebSocket.OPEN) return false;
    this.socket.send(payload);
    return true;
  }

  touch(nowMs = Date.now()) {
    this.lastSeenAtMs = Number(nowMs || Date.now());
    this.awaitingPong = false;
  }

  sweepHeartbeat({ timeoutMs = 0, nowMs = Date.now(), onTimeout = null } = {}) {
    const socket = this.socket;
    if (!socket || this.phase !== UPSTREAM_TRANSPORT_PHASE.OPEN) return false;
    if (this.awaitingPong && timeoutMs > 0 && nowMs - this.lastSeenAtMs >= timeoutMs) {
      onTimeout?.({ socket, generation: this.generation });
      return false;
    }
    this.awaitingPong = true;
    try { socket.ping?.(); } catch { onTimeout?.({ socket, generation: this.generation }); }
    return true;
  }

  close(code = 1000, reason = "closed") {
    const socket = this.socket;
    if (!socket) return false;
    const handlers = this.handlers;
    this.generation += 1;
    this.socket = null;
    this.handlers = null;
    this.purpose = "";
    this.phase = UPSTREAM_TRANSPORT_PHASE.IDLE;
    this._retireSocket(socket, code, reason);
    this.invokeHandler(handlers, "close", { socket, generation: this.generation, code, reason, locallyInitiated: true });
    return true;
  }

  dispose(code = 1000, reason = "disposed") {
    if (this.phase === UPSTREAM_TRANSPORT_PHASE.DISPOSED) return;
    const socket = this.socket;
    const handlers = this.handlers;
    this.generation += 1;
    this.socket = null;
    this.handlers = null;
    this.purpose = "";
    this.phase = UPSTREAM_TRANSPORT_PHASE.DISPOSED;
    this._retireSocket(socket, code, reason);
    if (socket) this.invokeHandler(handlers, "close", { socket, generation: this.generation, code, reason, locallyInitiated: true });
  }

  _retireSocket(socket, code = 1000, reason = "closed") {
    if (!socket || this.retiredSockets.has(socket)) return false;
    const isClosed = () => Number.isInteger(this.WebSocket.CLOSED)
      && socket.readyState === this.WebSocket.CLOSED;
    if (isClosed()) return false;
    this.retiredSockets.set(socket, null);
    try {
      socket.close?.(code, reason);
    } catch {
      try { socket.terminate?.(); } catch {}
      this._releaseRetiredSocket(socket);
      return true;
    }
    if (isClosed()) {
      this._releaseRetiredSocket(socket);
      return true;
    }
    const timer = setTimeout(() => {
      try { socket.terminate?.(); } catch {}
      this._releaseRetiredSocket(socket);
    }, this.closeGraceMs);
    timer.unref?.();
    this.retiredSockets.set(socket, timer);
    return true;
  }

  _releaseRetiredSocket(socket) {
    const timer = this.retiredSockets.get(socket);
    if (timer) clearTimeout(timer);
    this.retiredSockets.delete(socket);
  }

  status() {
    return {
      generation: this.generation,
      phase: this.phase,
      hasSocket: Boolean(this.socket),
      readyState: this.socket?.readyState ?? this.WebSocket.CLOSED,
      purpose: this.purpose,
      everConnected: this.everConnected,
      lastSeenAtMs: this.lastSeenAtMs,
      retiredSocketCount: this.retiredSockets.size,
    };
  }
}
