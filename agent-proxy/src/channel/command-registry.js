/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isCanonicalText } from "@noobot/shared/value";

export const PENDING_COMMAND_KIND = Object.freeze({
  TURN_SNAPSHOT: "turn_snapshot",
  EXECUTION_QUERY: "execution_query",
});

const PENDING_COMMAND_KINDS = new Set(Object.values(PENDING_COMMAND_KIND));

export class CommandRegistry {
  constructor({ now, ttlMs, onRemove, maxRemovals }) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.onRemove = onRemove;
    this.maxRemovals = maxRemovals;
    this.commands = new Map();
    this.removals = new Map();
  }

  register(commandId, { channelKey, kind, socket, settle }) {
    if (!isCanonicalText(commandId) || !isCanonicalText(channelKey)) {
      throw new TypeError("pending command requires canonical commandId and channelKey");
    }
    if (!PENDING_COMMAND_KINDS.has(kind))
      throw new TypeError(`unknown pending command kind: ${kind}`);
    if (this.commands.has(commandId))
      throw new TypeError(`pending command already registered: ${commandId}`);
    const createdAtMs = this.now();
    const record = {
      commandId,
      channelKey,
      kind,
      socket,
      settle,
      createdAtMs,
      expiresAtMs: createdAtMs + this.ttlMs,
    };
    this.commands.set(commandId, record);
    return record;
  }

  take(commandId, { channelKey, kind }, reason) {
    const record = this.commands.get(commandId);
    if (!record || record.channelKey !== channelKey || record.kind !== kind) return null;
    return this.remove(record, reason);
  }

  remove(record, reason) {
    this.commands.delete(record.commandId);
    const removedAtMs = this.now();
    const removal = {
      commandId: record.commandId,
      channelKey: record.channelKey,
      commandType: record.kind,
      reason,
      registeredForMs: Math.max(0, removedAtMs - record.createdAtMs),
      removedAtMs,
    };
    this.rememberRemoval(removal);
    this.onRemove(removal);
    return record;
  }

  rememberRemoval(removal) {
    this.removals.delete(removal.commandId);
    this.removals.set(removal.commandId, removal);
    while (this.removals.size > this.maxRemovals) {
      this.removals.delete(this.removals.keys().next().value);
    }
  }

  lastRemoval(commandId) {
    return this.removals.get(commandId) || null;
  }

  cancelSocket(socket) {
    let cancelled = 0;
    for (const record of [...this.commands.values()]) {
      if (record.socket !== socket) continue;
      this.remove(record, "requester_disconnected");
      cancelled += 1;
    }
    return cancelled;
  }

  cleanup(channelExists) {
    const currentMs = this.now();
    for (const record of [...this.commands.values()]) {
      if (!channelExists(record.channelKey)) this.remove(record, "channel_missing");
      else if (currentMs >= record.expiresAtMs) this.remove(record, "ttl_expired");
    }
  }
}
