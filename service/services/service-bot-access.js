/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { isFunction } from "@noobot/shared/value";

export function createServiceBotAccess({ getBot }) {
  if (!isFunction(getBot)) throw new TypeError("Service Bot access requires getBot");
  const context = new AsyncLocalStorage();
  const waiters = new Set();
  let active = 0;
  let state = "active";
  const unavailable = () =>
    Object.assign(new Error("Service runtime is unavailable"), {
      code: "RUNTIME_CLOSED",
      statusCode: 503,
    });
  const resolveBot = () => {
    const lease = context.getStore();
    if (lease) {
      if (!lease.active) throw unavailable();
      return lease.bot;
    }
    if (state !== "active") throw unavailable();
    const bot = getBot();
    if (bot === null) throw unavailable();
    return bot;
  };
  const runOperation = async (operation) => {
    if (!isFunction(operation)) throw new TypeError("Service operation requires a callback");
    const bot = resolveBot();
    const lease = { bot, active: true };
    const continueOperation = async (continuation) => {
      if (!lease.active) throw unavailable();
      return context.run(lease, () => runOperation(continuation));
    };
    active += 1;
    try {
      return await context.run(lease, () => operation(continueOperation));
    } finally {
      lease.active = false;
      active -= 1;
      if (active === 0) {
        for (const resolve of waiters) resolve();
        waiters.clear();
      }
    }
  };
  const withRetirement = async (operation) => {
    if (!isFunction(operation)) throw new TypeError("Runtime retirement requires a callback");
    if (context.getStore() || state === "retiring")
      throw new Error("Runtime retirement must run outside a service operation");
    state = "retiring";
    try {
      if (active)
        await new Promise((resolve) => {
          waiters.add(resolve);
        });
      const result = await operation();
      state = "active";
      return result;
    } catch (cause) {
      state = "failed";
      throw cause;
    }
  };
  return Object.freeze({
    runOperation,
    runNewOperation: (operation) => context.exit(() => runOperation(operation)),
    getRetainedBot() {
      if (!context.getStore()) throw unavailable();
      return resolveBot();
    },
    withRetirement,
    get session() {
      return resolveBot().session;
    },
    getWorkspacePath: (...args) => resolveBot().getWorkspacePath(...args),
    ensureUserWorkspace: (...args) => resolveBot().ensureUserWorkspace(...args),
    resetUserWorkspace: (...args) => resolveBot().resetUserWorkspace(...args),
    syncUserWorkspace: (...args) => resolveBot().syncUserWorkspace(...args),
    loadUserConfig: (...args) => resolveBot().loadUserConfig(...args),
    replaceSessionTurn: (...args) => resolveBot().replaceSessionTurn(...args),
    openAttachmentStream: (...args) => resolveBot().openAttachmentStream(...args),
    deleteScopedAttachmentsBySessionIds: (...args) =>
      resolveBot().deleteScopedAttachmentsBySessionIds(...args),
    deleteSessionMemoryBySessionIds: (...args) =>
      resolveBot().deleteSessionMemoryBySessionIds(...args),
  });
}
