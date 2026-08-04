/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  createModelContext,
  resolveModelFinalMessages,
} from "@noobot/context-protocol";

export function ensureTestHookContext(ctx = {}) {
  if (!ctx || typeof ctx !== "object") return ctx;
  const explicitIdentity = ctx.activeTurnIdentity && typeof ctx.activeTurnIdentity === "object"
    ? ctx.activeTurnIdentity
    : null;
  const dialogProcessId = resolveDialogProcessId(ctx) ||
    String(explicitIdentity?.dialogProcessId || "test-dialog").trim();
  const turnScopeId = resolveTurnScopeId(ctx) ||
    String(explicitIdentity?.turnScopeId || `test-turn:${dialogProcessId}`).trim();
  const activeTurnIdentity = { dialogProcessId, turnScopeId };
  const stampRoundIdentity = (messages = []) => {
    for (const message of Array.isArray(messages) ? messages : []) {
      if (!message || typeof message !== "object") continue;
      const role = String(message?.role || message?.type || "").trim().toLowerCase();
      if (role === "system" || role === "developer") continue;
      if (!String(message.dialogProcessId || "").trim()) message.dialogProcessId = dialogProcessId;
      if (!String(message.turnScopeId || "").trim()) message.turnScopeId = turnScopeId;
    }
  };
  stampRoundIdentity(ctx.messages);
  stampRoundIdentity(ctx.messageBlocks?.history);
  stampRoundIdentity(ctx.messageBlocks?.incremental);
  if (ctx.modelContext?.protocolVersion !== 1) {
    const explicitMessageBlocks = ctx.messageBlocks || (
      !ctx.messageStore && !Array.isArray(ctx.messages)
        ? { system: [], history: [], incremental: [] }
        : null
    );
    ctx.modelContext = createModelContext({
      messageStore: ctx.messageStore || null,
      messages: Array.isArray(ctx.messages) ? ctx.messages : null,
      messageBlocks: explicitMessageBlocks,
      activeTurnIdentity,
    });
    ctx.contextProtocolVersion = 1;
  }
  if (!ctx.modelContext.activeTurnIdentity) {
    ctx.modelContext.activeTurnIdentity = activeTurnIdentity;
  }
  delete ctx.messageStore;
  delete ctx.messages;
  delete ctx.messageBlocks;
  delete ctx.activeTurnIdentity;
  return ctx;
}

export function createTestModelContext({
  messageStore = null,
  messages = null,
  messageBlocks = null,
  activeTurnIdentity = null,
} = {}) {
  return createModelContext({ messageStore, messages, messageBlocks, activeTurnIdentity });
}

export function createTestHookContext(ctx = {}, context = {}) {
  return ensureTestHookContext({
    ...ctx,
    messageStore: context.messageStore ?? ctx.messageStore,
    messages: context.messages ?? ctx.messages,
    messageBlocks: context.messageBlocks ?? ctx.messageBlocks,
    activeTurnIdentity: context.activeTurnIdentity ?? ctx.activeTurnIdentity,
  });
}

export function getTestContextMessages(ctx = {}) {
  return ctx?.modelContext?.messages || [];
}

export function getTestContextMessageBlocks(ctx = {}) {
  return ctx?.modelContext?.messageBlocks || {
    system: [],
    history: [],
    incremental: [],
  };
}

function resolveDialogProcessId(ctx = {}) {
  return String(
    ctx?.dialogProcessId ||
      ctx?.agentContext?.execution?.dialogProcessId ||
      ctx?.runtimeAgentContext?.execution?.dialogProcessId ||
      "",
  ).trim();
}

function resolveTurnScopeId(ctx = {}) {
  return String(
    ctx?.turnScopeId ||
      ctx?.runtime?.turnScopeId ||
      ctx?.runtime?.systemRuntime?.turnScopeId ||
      ctx?.agentContext?.execution?.controllers?.runtime?.systemRuntime?.turnScopeId ||
      "",
  ).trim();
}

/**
 * Public-contract hook host used by plugin tests. It intentionally models only
 * the host port exposed to plugins and does not import Agent internals.
 */
export function createTestHookManager() {
  const registry = new Map();
  let sequence = 0;

  function on(point = "", handler = null, options = {}) {
    const normalizedPoint = String(point || "").trim();
    if (!normalizedPoint || typeof handler !== "function") {
      throw new Error("hook point and handler are required");
    }
    const handlers = registry.get(normalizedPoint) || [];
    const item = {
      id: String(options?.id || `${normalizedPoint}_${handlers.length + 1}`),
      handler,
      once: options?.once === true,
      priority: Number.isFinite(Number(options?.priority)) ? Number(options.priority) : 0,
      sequence: ++sequence,
    };
    handlers.push(item);
    handlers.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
    registry.set(normalizedPoint, handlers);
    return () => off(normalizedPoint, item.id);
  }

  function once(point = "", handler = null, options = {}) {
    return on(point, handler, { ...options, once: true });
  }

  function off(point = "", id = "") {
    const normalizedPoint = String(point || "").trim();
    const handlers = registry.get(normalizedPoint) || [];
    const next = handlers.filter((item) => item.id !== String(id || ""));
    if (next.length === handlers.length) return false;
    if (next.length) registry.set(normalizedPoint, next);
    else registry.delete(normalizedPoint);
    return true;
  }

  function clear(point = "") {
    const normalizedPoint = String(point || "").trim();
    if (normalizedPoint) registry.delete(normalizedPoint);
    else registry.clear();
  }

  function list(point = "") {
    const normalizedPoint = String(point || "").trim();
    if (normalizedPoint) return [...(registry.get(normalizedPoint) || [])];
    return [...registry.entries()].map(([registeredPoint, handlers]) => ({
      point: registeredPoint,
      handlers: [...handlers],
    }));
  }

  async function run(point = "", context = {}) {
    const normalizedPoint = String(point || "").trim();
    const handlers = [...(registry.get(normalizedPoint) || [])];
    ensureTestHookContext(context);
    const results = [];
    const errors = [];
    for (const item of handlers) {
      try {
        const value = await item.handler(context);
        results.push({ ok: true, id: item.id, value });
      } catch (error) {
        errors.push(error);
        results.push({ ok: false, id: item.id, error });
      } finally {
        if (item.once) off(normalizedPoint, item.id);
      }
    }
    return { point: normalizedPoint, context, results, errors };
  }

  async function emit(point = "", context = {}) {
    const outcome = await run(point, context);
    return outcome.results.filter((item) => item.ok).map((item) => item.value);
  }

  return { on, once, off, clear, list, run, emit };
}

export function createTestResolveModelMessages() {
  return ({ ctx = {} } = {}) => {
    const modelContext = ctx?.modelContext;
    if (modelContext?.protocolVersion !== 1) {
      throw new Error("test model resolver requires modelContext protocolVersion=1");
    }
    const blocks = modelContext.messageBlocks;
    if (!blocks || typeof blocks !== "object") {
      throw new Error("test model resolver requires authoritative messageBlocks");
    }
    return resolveModelFinalMessages({
      systemMessages: Array.isArray(blocks.system) ? blocks.system : [],
      historyMessages: Array.isArray(blocks.history) ? blocks.history : [],
      incrementalMessages: Array.isArray(blocks.incremental) ? blocks.incremental : [],
    }).messages;
  };
}

export class TestModelMessageRuntimeHelpers {
  createResolveModelMessages() {
    return createTestResolveModelMessages();
  }
}
