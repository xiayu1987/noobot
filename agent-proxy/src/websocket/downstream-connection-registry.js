/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export class DownstreamConnectionRegistry {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.connections = new Map();
  }

  register(socket, { connectionId = "", onFinalize = null } = {}) {
    const id = String(connectionId || socket?.__agentProxySocketId || "").trim();
    if (!socket || !id) return null;
    const existing = this.connections.get(id);
    if (existing && !existing.finalized) return existing;
    const record = {
      connectionId: id,
      socket,
      connectedAtMs: this.now(),
      lastSeenAtMs: this.now(),
      awaitingPong: false,
      finalized: false,
      finalizeReason: "",
      onFinalize,
    };
    this.connections.set(id, record);
    return record;
  }

  touch(socketOrId) {
    const record = this.resolve(socketOrId);
    if (!record || record.finalized) return false;
    record.lastSeenAtMs = this.now();
    record.awaitingPong = false;
    return true;
  }

  finalize(socketOrId, reason = "closed") {
    const record = this.resolve(socketOrId);
    if (!record || record.finalized) return false;
    record.finalized = true;
    record.finalizeReason = String(reason || "closed").trim();
    this.connections.delete(record.connectionId);
    record.onFinalize?.(record);
    return true;
  }

  close(
    socketOrId,
    { code = 1000, reason = "closed", terminate = false, finalizeReason = reason } = {},
  ) {
    const record = this.resolve(socketOrId);
    if (!record || record.finalized) return false;
    try {
      if (terminate && typeof record.socket?.terminate === "function") {
        record.socket.terminate();
      } else {
        record.socket?.close?.(code, reason);
      }
    } catch {
      try {
        record.socket?.terminate?.();
      } catch (error) {
        console.warn("[agent-proxy] socket terminate failed", error);
      }
    }
    this.finalize(record.connectionId, finalizeReason);
    return true;
  }

  resolve(socketOrId) {
    if (!socketOrId) return null;
    if (typeof socketOrId === "string") return this.connections.get(socketOrId) || null;
    const id = String(socketOrId.__agentProxySocketId || "").trim();
    return id ? this.connections.get(id) || null : null;
  }

  sweepHeartbeat({ timeoutMs = 0, onTimeout = null } = {}) {
    const nowMs = this.now();
    for (const record of [...this.connections.values()]) {
      if (record.finalized) continue;
      if (record.awaitingPong && timeoutMs > 0 && nowMs - record.lastSeenAtMs >= timeoutMs) {
        onTimeout?.(record);
        continue;
      }
      record.awaitingPong = true;
      try {
        record.socket?.ping?.();
      } catch {
        onTimeout?.(record);
      }
    }
  }

  get size() {
    return this.connections.size;
  }
}
