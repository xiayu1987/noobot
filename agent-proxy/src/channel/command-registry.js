/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export class CommandRegistry {
  constructor({
    now = () => Date.now(),
    defaultTtlMs = 0,
    onRemove = null,
    maxRemovals = 256,
  } = {}) {
    this.now = now;
    this.defaultTtlMs = Math.max(0, Number(defaultTtlMs || 0));
    this.commands = new Map();
    this.routes = new Map();
    this.onRemove = typeof onRemove === "function" ? onRemove : null;
    this.maxRemovals = Math.max(0, Number(maxRemovals || 0));
    this.removals = new Map();
  }

  register(
    commandId,
    { channelKey = "", commandType = "command", requester = null, ttlMs = this.defaultTtlMs } = {},
  ) {
    const id = String(commandId || "").trim();
    if (!id) return null;
    const createdAtMs = this.now();
    const record = {
      commandId: id,
      channelKey: String(channelKey || "").trim(),
      commandType: String(commandType || "command").trim(),
      requester,
      createdAtMs,
      expiresAtMs: Number(ttlMs || 0) > 0 ? createdAtMs + Number(ttlMs) : 0,
    };
    this.commands.set(id, record);
    return record;
  }

  get(commandId) {
    return this.commands.get(String(commandId || "").trim()) || null;
  }

  consume(commandId) {
    return this.remove(commandId, "consumed");
  }

  delete(commandId, reason = "deleted") {
    return this.remove(commandId, reason) !== null;
  }

  remove(commandId, reason = "deleted") {
    const id = String(commandId || "").trim();
    const record = this.commands.get(id) || null;
    if (!record) return null;
    this.commands.delete(id);
    const removal = {
      commandId: id,
      channelKey: record.channelKey,
      commandType: record.commandType,
      reason: String(reason || "deleted").trim(),
      registeredForMs: Math.max(0, this.now() - record.createdAtMs),
      removedAtMs: this.now(),
    };
    this.rememberRemoval(removal);
    this.notifyRemoval(removal);
    return record;
  }

  notifyRemoval(removal) {
    try {
      this.onRemove?.(removal);
      return true;
    } catch {
      return false;
    }
  }

  rememberRemoval(removal) {
    if (!this.maxRemovals) return;
    this.removals.delete(removal.commandId);
    this.removals.set(removal.commandId, removal);
    while (this.removals.size > this.maxRemovals) {
      this.removals.delete(this.removals.keys().next().value);
    }
  }

  lastRemoval(commandId) {
    return this.removals.get(String(commandId || "").trim()) || null;
  }

  registerRoute(requestId, { channelKey = "", createdAtMs = this.now() } = {}) {
    const id = String(requestId || "").trim();
    if (!id) return null;
    const route = {
      channelKey: String(channelKey || "").trim(),
      createdAtMs: Number(createdAtMs || this.now()),
    };
    this.routes.set(id, route);
    return route;
  }

  cancelRequester(requester) {
    let cancelled = 0;
    for (const [commandId, record] of this.commands.entries()) {
      if (record.requester !== requester && record.requester?.socket !== requester) continue;
      this.remove(commandId, "requester_disconnected");
      record.requester?.resolve?.({ ok: false, reason: "requester_disconnected" });
      cancelled += 1;
    }
    return cancelled;
  }

  cleanup({ channelExists = () => true, interactionPending = () => false } = {}) {
    const currentMs = this.now();
    for (const [commandId, record] of this.commands.entries()) {
      if (!channelExists(record.channelKey)) this.remove(commandId, "channel_missing");
      else if (record.expiresAtMs > 0 && currentMs >= record.expiresAtMs)
        this.remove(commandId, "ttl_expired");
    }
    for (const [requestId, route] of this.routes.entries()) {
      if (interactionPending(route.channelKey, requestId)) continue;
      if (
        !channelExists(route.channelKey) ||
        !route.createdAtMs ||
        currentMs - route.createdAtMs >= this.defaultTtlMs
      ) {
        this.routes.delete(requestId);
      }
    }
  }

  createMapFacade(channelKey, commandType) {
    const registry = this;
    return {
      set(commandId, requester) {
        registry.register(commandId, { channelKey, commandType, requester });
        return this;
      },
      get(commandId) {
        const record = registry.get(commandId);
        return record?.channelKey === channelKey && record?.commandType === commandType
          ? record.requester
          : undefined;
      },
      delete(commandId, reason = "deleted") {
        const record = registry.get(commandId);
        if (record?.channelKey !== channelKey || record?.commandType !== commandType) return false;
        return registry.delete(commandId, reason);
      },
      has(commandId) {
        return this.get(commandId) !== undefined;
      },
      get size() {
        return [...registry.commands.values()].filter(
          (record) => record.channelKey === channelKey && record.commandType === commandType,
        ).length;
      },
    };
  }
}
