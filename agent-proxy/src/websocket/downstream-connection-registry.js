/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export class DownstreamConnectionRegistry {
  constructor({ now }) {
    this.now = now;
    this.connections = new Map();
  }

  register(socket, { onFinalize }) {
    const id = socket.__agentProxySocketId;
    if (this.connections.has(id)) {
      throw new TypeError(`downstream connection already registered: ${id}`);
    }
    this.connections.set(id, { socket, lastSeenAtMs: this.now(), awaitingPong: false, onFinalize });
  }

  touch(socket) {
    const record = this.connections.get(socket.__agentProxySocketId);
    if (!record) return false;
    record.lastSeenAtMs = this.now();
    record.awaitingPong = false;
    return true;
  }

  finalize(socket, reason) {
    const id = socket.__agentProxySocketId;
    const record = this.connections.get(id);
    if (!record) return false;
    this.connections.delete(id);
    record.onFinalize(reason);
    return true;
  }

  close(socket, { code, reason }) {
    if (!this.connections.has(socket.__agentProxySocketId)) return false;
    socket.close(code, reason);
    return this.finalize(socket, reason);
  }

  terminate(socket, reason) {
    if (!this.connections.has(socket.__agentProxySocketId)) return false;
    socket.terminate();
    return this.finalize(socket, reason);
  }

  sweepHeartbeat({ timeoutMs, onTimeout }) {
    const nowMs = this.now();
    for (const record of [...this.connections.values()]) {
      if (record.awaitingPong && nowMs - record.lastSeenAtMs >= timeoutMs) {
        onTimeout(record.socket);
        continue;
      }
      record.awaitingPong = true;
      record.socket.ping();
    }
  }

  get size() {
    return this.connections.size;
  }
}
