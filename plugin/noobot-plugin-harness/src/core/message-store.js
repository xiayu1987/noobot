/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function normalizeBlockList(value) {
  return Array.isArray(value) ? value : [];
}

function readField(message = {}, field = "") {
  const key = String(field || "").trim();
  if (!key) return "";
  return String(
    message?.[key] ||
      message?.additional_kwargs?.[key] ||
      message?.lc_kwargs?.[key] ||
      message?.lc_kwargs?.additional_kwargs?.[key] ||
      "",
  ).trim();
}

function resolveRole(message = {}) {
  const role = String(message?.role || message?.lc_kwargs?.role || "").trim().toLowerCase();
  if (role) return role;
  const type = String(message?.type || message?.lc_kwargs?.type || "").trim().toLowerCase();
  if (type === "ai") return "assistant";
  if (type === "human") return "user";
  return type;
}

function resolveContent(message = {}) {
  return String(message?.content ?? message?.lc_kwargs?.content ?? "");
}

function resolveToolCallId(message = {}) {
  return String(
    message?.tool_call_id ||
      message?.toolCallId ||
      message?.lc_kwargs?.tool_call_id ||
      message?.lc_kwargs?.toolCallId ||
      "",
  ).trim();
}

function resolveAssistantToolCallIds(message = {}) {
  const calls = Array.isArray(message?.tool_calls)
    ? message.tool_calls
    : Array.isArray(message?.lc_kwargs?.tool_calls)
      ? message.lc_kwargs.tool_calls
      : Array.isArray(message?.additional_kwargs?.tool_calls)
        ? message.additional_kwargs.tool_calls
        : [];
  return calls
    .map((call = {}) => String(call?.id || call?.tool_call_id || call?.toolCallId || "").trim())
    .filter(Boolean)
    .join(",");
}

function buildMessageStoreKey(message = {}) {
  return [
    resolveRole(message),
    resolveToolCallId(message),
    resolveAssistantToolCallIds(message),
    readField(message, "injectedMessageType") || readField(message, "injected_message_type"),
    readField(message, "dialogProcessId"),
    readField(message, "turnScopeId"),
    resolveContent(message),
  ].join("|||");
}

function resolveMessageId(message = {}) {
  return readField(message, "noobotMessageId") ||
    readField(message, "messageId") ||
    readField(message, "id");
}

function ensureMessageMetadata(message = {}) {
  if (!message || typeof message !== "object") return {};
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") {
    message.additional_kwargs = {};
  }
  return message.additional_kwargs;
}

function assignMessageId(message = {}, id = "") {
  const normalizedId = String(id || "").trim();
  if (!message || typeof message !== "object" || !normalizedId) return "";
  const additionalKwargs = ensureMessageMetadata(message);
  additionalKwargs.noobotMessageId = normalizedId;
  if (message.lc_kwargs && typeof message.lc_kwargs === "object") {
    message.lc_kwargs.noobotMessageId = normalizedId;
    if (!message.lc_kwargs.additional_kwargs || typeof message.lc_kwargs.additional_kwargs !== "object") {
      message.lc_kwargs.additional_kwargs = {};
    }
    message.lc_kwargs.additional_kwargs.noobotMessageId = normalizedId;
  }
  return normalizedId;
}

function isSummarized(message = {}) {
  return message?.summarized === true ||
    message?.lc_kwargs?.summarized === true ||
    message?.additional_kwargs?.summarized === true ||
    message?.lc_kwargs?.additional_kwargs?.summarized === true;
}

function mergeMessageState(target = {}, source = {}) {
  if (!target || typeof target !== "object" || !source || typeof source !== "object") return target;
  if (isSummarized(source)) {
    target.summarized = true;
    if (target.lc_kwargs && typeof target.lc_kwargs === "object") {
      target.lc_kwargs.summarized = true;
    }
  }
  return target;
}

function markMessageSummarized(message = null) {
  if (!message || typeof message !== "object") return false;
  if (isSummarized(message)) return false;
  message.summarized = true;
  if (message.lc_kwargs && typeof message.lc_kwargs === "object") {
    message.lc_kwargs.summarized = true;
  }
  return true;
}

function resolveStore(ctx = {}) {
  if (ctx?.messageStore && typeof ctx.messageStore === "object" && !Array.isArray(ctx.messageStore)) {
    if (!(ctx.messageStore.byKey instanceof Map)) ctx.messageStore.byKey = new Map();
    if (!(ctx.messageStore.byId instanceof Map)) ctx.messageStore.byId = new Map();
    if (!Array.isArray(ctx.messageStore.messages)) ctx.messageStore.messages = [];
    if (!Number.isFinite(Number(ctx.messageStore.nextId))) {
      ctx.messageStore.nextId = ctx.messageStore.messages.length + 1;
    }
    return ctx.messageStore;
  }
  const store = { messages: [], byKey: new Map(), byId: new Map(), nextId: 1 };
  ctx.messageStore = store;
  return store;
}

function nextMessageId(store = {}) {
  const next = Math.max(1, Math.trunc(Number(store.nextId) || 1));
  store.nextId = next + 1;
  return `hm_${next.toString(36)}`;
}

function canonicalizeMessage(store = null, message = null) {
  if (!store || !message || typeof message !== "object") return message;
  const existingId = resolveMessageId(message);
  if (existingId && store.byId.has(existingId)) {
    const existingById = store.byId.get(existingId);
    mergeMessageState(existingById, message);
    return existingById;
  }
  const key = buildMessageStoreKey(message);
  if (!key) {
    const id = existingId || nextMessageId(store);
    assignMessageId(message, id);
    store.byId.set(id, message);
    store.messages.push(message);
    return message;
  }
  const existing = store.byKey.get(key);
  if (existing) {
    mergeMessageState(existing, message);
    assignMessageId(message, resolveMessageId(existing));
    return existing;
  }
  const id = existingId || nextMessageId(store);
  assignMessageId(message, id);
  store.byKey.set(key, message);
  store.byId.set(id, message);
  store.messages.push(message);
  return message;
}

function canonicalizeList(store = null, messages = []) {
  return normalizeBlockList(messages).map((message) => canonicalizeMessage(store, message));
}

function syncBlockIds(blocks = null) {
  if (!blocks || typeof blocks !== "object" || Array.isArray(blocks)) return blocks;
  blocks.systemIds = normalizeBlockList(blocks.system).map((message) => resolveMessageId(message)).filter(Boolean);
  blocks.historyIds = normalizeBlockList(blocks.history).map((message) => resolveMessageId(message)).filter(Boolean);
  blocks.incrementalIds = normalizeBlockList(blocks.incremental).map((message) => resolveMessageId(message)).filter(Boolean);
  return blocks;
}

export function canonicalizeMessageStore(ctx = {}) {
  if (!ctx || typeof ctx !== "object") return null;
  const store = resolveStore(ctx);
  const messages = Array.isArray(ctx.messages) ? ctx.messages : null;
  if (messages) {
    messages.splice(0, messages.length, ...canonicalizeList(store, messages));
  }
  const blocks =
    ctx.messageBlocks && typeof ctx.messageBlocks === "object" && !Array.isArray(ctx.messageBlocks)
      ? ctx.messageBlocks
      : null;
  if (blocks) {
    blocks.system = canonicalizeList(store, blocks.system);
    blocks.history = canonicalizeList(store, blocks.history);
    blocks.incremental = canonicalizeList(store, blocks.incremental);
    syncBlockIds(blocks);
  }
  return store;
}

export function canonicalizeMessageBlockViews(ctx = {}, blocks = {}) {
  const store = canonicalizeMessageStore(ctx) || resolveStore(ctx);
  return syncBlockIds({
    system: canonicalizeList(store, blocks.system),
    history: canonicalizeList(store, blocks.history),
    incremental: canonicalizeList(store, blocks.incremental),
  });
}

export function getMessageId(message = {}) {
  return resolveMessageId(message);
}

export function resolveMessagesByIds(ctx = {}, ids = []) {
  const store = resolveStore(ctx);
  return (Array.isArray(ids) ? ids : [])
    .map((id) => store.byId.get(String(id || "").trim()))
    .filter(Boolean);
}

export function replaceMessages(ctx = {}, messages = []) {
  if (!ctx || typeof ctx !== "object") return [];
  const store = canonicalizeMessageStore(ctx) || resolveStore(ctx);
  const canonicalMessages = canonicalizeList(store, messages);
  if (!Array.isArray(ctx.messages)) ctx.messages = [];
  ctx.messages.splice(0, ctx.messages.length, ...canonicalMessages);
  canonicalizeMessageStore(ctx);
  return ctx.messages;
}

export function writeMessageBlocks(ctx = {}, blocks = {}) {
  if (!ctx || typeof ctx !== "object") return null;
  const existing =
    ctx.messageBlocks && typeof ctx.messageBlocks === "object" && !Array.isArray(ctx.messageBlocks)
      ? ctx.messageBlocks
      : {};
  const canonicalBlocks = canonicalizeMessageBlockViews(ctx, blocks);
  existing.system = canonicalBlocks.system;
  existing.history = canonicalBlocks.history;
  existing.incremental = canonicalBlocks.incremental;
  existing.systemIds = canonicalBlocks.systemIds;
  existing.historyIds = canonicalBlocks.historyIds;
  existing.incrementalIds = canonicalBlocks.incrementalIds;
  ctx.messageBlocks = existing;
  return existing;
}

export function appendMessage(ctx = {}, message = {}, { block = "" } = {}) {
  if (!ctx || typeof ctx !== "object") return message;
  const store = canonicalizeMessageStore(ctx) || resolveStore(ctx);
  const canonicalMessage = canonicalizeMessage(store, message);
  if (!Array.isArray(ctx.messages)) ctx.messages = [];
  if (!ctx.messages.includes(canonicalMessage)) ctx.messages.push(canonicalMessage);
  const blockName = String(block || "").trim();
  if (["system", "history", "incremental"].includes(blockName)) {
    const currentBlocks =
      ctx.messageBlocks && typeof ctx.messageBlocks === "object" && !Array.isArray(ctx.messageBlocks)
        ? ctx.messageBlocks
        : { system: [], history: [], incremental: [] };
    const nextBlocks = {
      system: normalizeBlockList(currentBlocks.system),
      history: normalizeBlockList(currentBlocks.history),
      incremental: normalizeBlockList(currentBlocks.incremental),
    };
    if (!nextBlocks[blockName].includes(canonicalMessage)) {
      nextBlocks[blockName] = [...nextBlocks[blockName], canonicalMessage];
    }
    writeMessageBlocks(ctx, nextBlocks);
  }
  canonicalizeMessageStore(ctx);
  return canonicalMessage;
}

export function markSummarized(ctx = {}, ids = []) {
  const messages = resolveMessagesByIds(ctx, ids);
  let changedCount = 0;
  for (const message of messages) {
    if (markMessageSummarized(message)) changedCount += 1;
  }
  return changedCount;
}
