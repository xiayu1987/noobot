/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export class CommandRegistry {
  constructor({ now = () => Date.now(), defaultTtlMs = 0 } = {}) {
    this.now = now;
    this.defaultTtlMs = Math.max(0, Number(defaultTtlMs || 0));
    this.commands = new Map();
    this.routes = new Map();
  }

  register(commandId, { channelKey = "", commandType = "command", requester = null, ttlMs = this.defaultTtlMs } = {}) {
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
    const id = String(commandId || "").trim();
    const record = this.commands.get(id) || null;
    if (record) this.commands.delete(id);
    return record;
  }

  delete(commandId) {
    return this.commands.delete(String(commandId || "").trim());
  }

  registerRoute(requestId, { channelKey = "", createdAtMs = this.now() } = {}) {
    const id = String(requestId || "").trim();
    if (!id) return null;
    const route = { channelKey: String(channelKey || "").trim(), createdAtMs: Number(createdAtMs || this.now()) };
    this.routes.set(id, route);
    return route;
  }

  cancelRequester(requester) {
    let cancelled = 0;
    for (const [commandId, record] of this.commands.entries()) {
      if (record.requester !== requester && record.requester?.socket !== requester) continue;
      this.commands.delete(commandId);
      record.requester?.resolve?.({ ok: false, reason: "requester_disconnected" });
      cancelled += 1;
    }
    return cancelled;
  }

  cleanup({ channelExists = () => true, interactionPending = () => false } = {}) {
    const currentMs = this.now();
    for (const [commandId, record] of this.commands.entries()) {
      if (!channelExists(record.channelKey) || (record.expiresAtMs > 0 && currentMs >= record.expiresAtMs)) {
        this.commands.delete(commandId);
      }
    }
    for (const [requestId, route] of this.routes.entries()) {
      if (interactionPending(route.channelKey, requestId)) continue;
      if (!channelExists(route.channelKey) || !route.createdAtMs || currentMs - route.createdAtMs >= this.defaultTtlMs) {
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
      delete(commandId) {
        const record = registry.get(commandId);
        if (record?.channelKey !== channelKey || record?.commandType !== commandType) return false;
        return registry.delete(commandId);
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
