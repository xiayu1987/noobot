/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function normalizeList(value) {
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
  const type = String(
    message?.type ||
      message?.lc_kwargs?.type ||
      (typeof message?._getType === "function" ? message._getType() : ""),
  ).trim().toLowerCase();
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

function buildMessageKey(message = {}) {
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

function resolveStore(holder = {}) {
  if (holder?.messageStore && typeof holder.messageStore === "object" && !Array.isArray(holder.messageStore)) {
    if (!(holder.messageStore.byKey instanceof Map)) holder.messageStore.byKey = new Map();
    if (!(holder.messageStore.byId instanceof Map)) holder.messageStore.byId = new Map();
    if (!Array.isArray(holder.messageStore.messages)) holder.messageStore.messages = [];
    if (!Number.isFinite(Number(holder.messageStore.nextId))) {
      holder.messageStore.nextId = holder.messageStore.messages.length + 1;
    }
    return holder.messageStore;
  }
  const store = { messages: [], byKey: new Map(), byId: new Map(), nextId: 1 };
  holder.messageStore = store;
  return store;
}

function nextMessageId(store = {}) {
  const next = Math.max(1, Math.trunc(Number(store.nextId) || 1));
  store.nextId = next + 1;
  return `am_${next.toString(36)}`;
}

function canonicalizeMessage(store = null, message = null) {
  if (!store || !message || typeof message !== "object") return message;
  const existingId = resolveMessageId(message);
  if (existingId && store.byId.has(existingId)) {
    const existingById = store.byId.get(existingId);
    mergeMessageState(existingById, message);
    return existingById;
  }
  const key = buildMessageKey(message);
  const existing = key ? store.byKey.get(key) : null;
  if (existing) {
    mergeMessageState(existing, message);
    assignMessageId(message, resolveMessageId(existing));
    return existing;
  }
  const id = existingId || nextMessageId(store);
  assignMessageId(message, id);
  if (key) store.byKey.set(key, message);
  store.byId.set(id, message);
  store.messages.push(message);
  return message;
}

function canonicalizeList(store = null, messages = []) {
  return normalizeList(messages).map((message) => canonicalizeMessage(store, message));
}

function syncBlockIds(blocks = null) {
  if (!blocks || typeof blocks !== "object" || Array.isArray(blocks)) return blocks;
  blocks.systemIds = normalizeList(blocks.system).map((message) => resolveMessageId(message)).filter(Boolean);
  blocks.historyIds = normalizeList(blocks.history).map((message) => resolveMessageId(message)).filter(Boolean);
  blocks.incrementalIds = normalizeList(blocks.incremental).map((message) => resolveMessageId(message)).filter(Boolean);
  return blocks;
}

export function canonicalizeMessageStore(holder = {}) {
  if (!holder || typeof holder !== "object") return null;
  const store = resolveStore(holder);
  if (Array.isArray(holder.messages)) {
    holder.messages.splice(0, holder.messages.length, ...canonicalizeList(store, holder.messages));
  }
  const blocks =
    holder.messageBlocks && typeof holder.messageBlocks === "object" && !Array.isArray(holder.messageBlocks)
      ? holder.messageBlocks
      : null;
  if (blocks) {
    blocks.system = canonicalizeList(store, blocks.system);
    blocks.history = canonicalizeList(store, blocks.history);
    blocks.incremental = canonicalizeList(store, blocks.incremental);
    syncBlockIds(blocks);
  }
  return store;
}

export function getMessageId(message = {}) {
  return resolveMessageId(message);
}

export function resolveMessagesByIds(holder = {}, ids = []) {
  const store = resolveStore(holder);
  return normalizeList(ids)
    .map((id) => store.byId.get(String(id || "").trim()))
    .filter(Boolean);
}

export function replaceMessages(holder = {}, messages = []) {
  if (!holder || typeof holder !== "object") return [];
  const store = canonicalizeMessageStore(holder) || resolveStore(holder);
  const canonicalMessages = canonicalizeList(store, messages);
  if (!Array.isArray(holder.messages)) holder.messages = [];
  holder.messages.splice(0, holder.messages.length, ...canonicalMessages);
  canonicalizeMessageStore(holder);
  return holder.messages;
}

export function writeMessageBlocks(holder = {}, blocks = {}) {
  if (!holder || typeof holder !== "object") return null;
  const existing =
    holder.messageBlocks && typeof holder.messageBlocks === "object" && !Array.isArray(holder.messageBlocks)
      ? holder.messageBlocks
      : {};
  const store = canonicalizeMessageStore(holder) || resolveStore(holder);
  existing.system = canonicalizeList(store, blocks.system);
  existing.history = canonicalizeList(store, blocks.history);
  existing.incremental = canonicalizeList(store, blocks.incremental);
  syncBlockIds(existing);
  holder.messageBlocks = existing;
  return existing;
}

export function appendMessage(holder = {}, message = {}, { block = "" } = {}) {
  if (!holder || typeof holder !== "object") return message;
  const store = canonicalizeMessageStore(holder) || resolveStore(holder);
  const canonicalMessage = canonicalizeMessage(store, message);
  if (!Array.isArray(holder.messages)) holder.messages = [];
  if (!holder.messages.includes(canonicalMessage)) holder.messages.push(canonicalMessage);
  const blockName = String(block || "").trim();
  if (["system", "history", "incremental"].includes(blockName)) {
    const currentBlocks =
      holder.messageBlocks && typeof holder.messageBlocks === "object" && !Array.isArray(holder.messageBlocks)
        ? holder.messageBlocks
        : { system: [], history: [], incremental: [] };
    const nextBlocks = {
      system: normalizeList(currentBlocks.system),
      history: normalizeList(currentBlocks.history),
      incremental: normalizeList(currentBlocks.incremental),
    };
    if (!nextBlocks[blockName].includes(canonicalMessage)) {
      nextBlocks[blockName] = [...nextBlocks[blockName], canonicalMessage];
    }
    writeMessageBlocks(holder, nextBlocks);
  }
  canonicalizeMessageStore(holder);
  return canonicalMessage;
}
