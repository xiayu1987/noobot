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

const ROUND_IDENTITY_FIELDS = ["dialogProcessId", "turnScopeId"];

function normalizeRoundIdentity(identity = {}) {
  return Object.fromEntries(
    ROUND_IDENTITY_FIELDS.map((field) => [field, String(identity?.[field] || "").trim()]),
  );
}

function requireCompleteRoundIdentity(identity = {}, label = "round identity") {
  const normalized = normalizeRoundIdentity(identity);
  const presentCount = ROUND_IDENTITY_FIELDS.filter((field) => normalized[field]).length;
  if (presentCount !== 0 && presentCount !== ROUND_IDENTITY_FIELDS.length) {
    throw new Error(`${label} must contain dialogProcessId and turnScopeId as one identity`);
  }
  return normalized;
}

function applyActiveTurnIdentity(holder = {}, message = {}) {
  const active = requireCompleteRoundIdentity(
    holder?.activeTurnIdentity,
    "modelContext.activeTurnIdentity",
  );
  const existing = normalizeRoundIdentity(
    Object.fromEntries(ROUND_IDENTITY_FIELDS.map((field) => [field, readField(message, field)])),
  );
  if (!active.dialogProcessId) {
    requireCompleteRoundIdentity(existing, "canonical message round identity");
    return message;
  }
  for (const field of ROUND_IDENTITY_FIELDS) {
    if (existing[field] && existing[field] !== active[field]) {
      throw new Error(`canonical message ${field} conflicts with the active turn identity`);
    }
    message[field] = active[field];
  }
  return message;
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

function resolveMessageId(message = {}) {
  const canonicalMessageId = readField(message, "noobotMessageId");
  const persistedMessageUid = String(message?.messageUid || "").trim();
  if (canonicalMessageId && persistedMessageUid && canonicalMessageId !== persistedMessageUid) {
    throw new Error("persisted messageUid conflicts with canonical noobotMessageId");
  }
  return canonicalMessageId || persistedMessageUid;
}

export function deriveMessageProjectionId(sourceMessageId = "", projectionType = "") {
  const sourceId = String(sourceMessageId || "").trim();
  const type = String(projectionType || "").trim();
  if (!sourceId || !type) return "";
  return `${sourceId}::${type}`;
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

function resolveMessageContent(message = {}) {
  const content = message?.content ?? message?.lc_kwargs?.content ?? "";
  return typeof content === "string" ? content : JSON.stringify(content);
}

function resolveToolCallId(message = {}) {
  return readField(message, "tool_call_id") || readField(message, "toolCallId");
}

function resolveToolCallIds(message = {}) {
  const calls = Array.isArray(message?.tool_calls)
    ? message.tool_calls
    : Array.isArray(message?.lc_kwargs?.tool_calls)
      ? message.lc_kwargs.tool_calls
      : [];
  return calls.map((call = {}) => String(call?.id || call?.tool_call_id || "").trim());
}

function canonicalEntityShape(message = {}) {
  return JSON.stringify({
    role: resolveRole(message),
    content: resolveMessageContent(message),
    toolCallId: resolveToolCallId(message),
    toolCallIds: resolveToolCallIds(message),
    internalType: readField(message, "noobotInternalMessageType"),
  });
}

function resolveStore(holder = {}) {
  if (holder?.messageStore && typeof holder.messageStore === "object" && !Array.isArray(holder.messageStore)) {
    if (!(holder.messageStore.byId instanceof Map)) holder.messageStore.byId = new Map();
    if (!Array.isArray(holder.messageStore.messages)) holder.messageStore.messages = [];
    if (!Number.isFinite(Number(holder.messageStore.nextId))) {
      holder.messageStore.nextId = holder.messageStore.messages.length + 1;
    }
    return holder.messageStore;
  }
  const store = { messages: [], byId: new Map(), nextId: 1 };
  holder.messageStore = store;
  return store;
}

function nextMessageId(store = {}) {
  let next = Math.max(1, Math.trunc(Number(store.nextId) || 1));
  let id = `am_${next.toString(36)}`;
  while (store.byId instanceof Map && store.byId.has(id)) {
    next += 1;
    id = `am_${next.toString(36)}`;
  }
  store.nextId = next + 1;
  return id;
}

function bumpNextMessageId(store = {}, id = "") {
  if (!store || typeof store !== "object") return;
  const normalizedId = String(id || "").trim();
  const match = normalizedId.match(/^am_([0-9a-z]+)$/i);
  if (!match) return;
  const numeric = Number.parseInt(match[1], 36);
  if (!Number.isFinite(numeric) || numeric < 1) return;
  const current = Math.max(1, Math.trunc(Number(store.nextId) || 1));
  if (current <= numeric) store.nextId = numeric + 1;
}

function reserveExplicitMessageIds(store = null, messageLists = []) {
  if (!store || typeof store !== "object") return;
  if (store.byId instanceof Map) {
    for (const id of store.byId.keys()) bumpNextMessageId(store, id);
  }
  for (const message of normalizeList(store.messages)) {
    bumpNextMessageId(store, resolveMessageId(message));
  }
  for (const messages of normalizeList(messageLists)) {
    for (const message of normalizeList(messages)) {
      bumpNextMessageId(store, resolveMessageId(message));
    }
  }
}

function canonicalizeMessage(store = null, message = null) {
  if (!store || !message || typeof message !== "object") return message;
  const existingId = resolveMessageId(message);
  if (existingId && store.byId.has(existingId)) {
    const existingById = store.byId.get(existingId);
    if (canonicalEntityShape(existingById) !== canonicalEntityShape(message)) {
      throw new Error(`canonical message id collision: ${existingId}`);
    }
    mergeMessageState(existingById, message);
    return existingById;
  }
  const id = existingId || nextMessageId(store);
  assignMessageId(message, id);
  bumpNextMessageId(store, id);
  store.byId.set(id, message);
  store.messages.push(message);
  return message;
}

function canonicalizeList(store = null, messages = []) {
  reserveExplicitMessageIds(store, [messages]);
  return normalizeList(messages).map((message) => canonicalizeMessage(store, message));
}

function isKnownCanonicalEntity(store = null, message = {}) {
  if (!store || !message || typeof message !== "object") return false;
  if (normalizeList(store.messages).includes(message)) return true;
  const id = resolveMessageId(message);
  return Boolean(id && store.byId instanceof Map && store.byId.has(id));
}

function prepareNewCanonicalEntities(holder = {}, store = null, messages = []) {
  const prepared = [];
  const seen = new Set();
  for (const message of normalizeList(messages)) {
    if (!message || typeof message !== "object" || seen.has(message)) continue;
    seen.add(message);
    if (isKnownCanonicalEntity(store, message)) continue;
    applyActiveTurnIdentity(holder, message);
    prepared.push(message);
  }
  return prepared;
}

function notifyCanonicalEntitiesAdded(holder = {}, messages = [], meta = {}) {
  if (typeof holder?.onCanonicalMessageAdded !== "function") return;
  for (const message of normalizeList(messages)) {
    holder.onCanonicalMessageAdded(message, meta);
  }
}

function syncBlockIds(blocks = null) {
  if (!blocks || typeof blocks !== "object" || Array.isArray(blocks)) return blocks;
  for (const staleField of ["system", "history", "incremental"].map((name) => `${name}Ids`)) {
    delete blocks[staleField];
  }
  return blocks;
}

export function canonicalizeMessageStore(holder = {}) {
  if (!holder || typeof holder !== "object") return null;
  const store = resolveStore(holder);
  const blocks =
    holder.messageBlocks && typeof holder.messageBlocks === "object" && !Array.isArray(holder.messageBlocks)
      ? holder.messageBlocks
      : null;
  reserveExplicitMessageIds(store, [
    holder.messages,
    blocks?.system,
    blocks?.history,
    blocks?.incremental,
  ]);
  if (Array.isArray(holder.messages)) {
    holder.messages.splice(0, holder.messages.length, ...canonicalizeList(store, holder.messages));
  }
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

export function markMessagesSummarizedByIds(holder = {}, ids = []) {
  const messages = resolveMessagesByIds(holder, ids);
  let changedCount = 0;
  for (const message of messages) {
    if (isSummarized(message)) continue;
    message.summarized = true;
    if (message.lc_kwargs && typeof message.lc_kwargs === "object") {
      message.lc_kwargs.summarized = true;
    }
    changedCount += 1;
  }
  return changedCount;
}

export function replaceMessages(holder = {}, messages = []) {
  if (!holder || typeof holder !== "object") return [];
  const store = holder.messageStore && typeof holder.messageStore === "object"
    ? resolveStore(holder)
    : (canonicalizeMessageStore(holder) || resolveStore(holder));
  const addedEntities = prepareNewCanonicalEntities(holder, store, messages);
  const canonicalMessages = canonicalizeList(store, messages);
  if (!Array.isArray(holder.messages)) holder.messages = [];
  holder.messages.splice(0, holder.messages.length, ...canonicalMessages);
  const blocks = holder.messageBlocks && typeof holder.messageBlocks === "object"
    ? holder.messageBlocks
    : null;
  if (blocks) {
    const retained = new Set(canonicalMessages);
    const assigned = new Set();
    for (const blockName of ["system", "history", "incremental"]) {
      // History is an immutable context block. Replacing the active flat
      // projection must not discard historical entities that are intentionally
      // absent from that projection.
      const next = blockName === "history"
        ? normalizeList(blocks[blockName])
        : normalizeList(blocks[blockName]).filter((message) => retained.has(message));
      blocks[blockName] = next;
      for (const message of next) assigned.add(message);
    }
    for (const message of canonicalMessages) {
      if (assigned.has(message)) continue;
      const blockName = ["system", "developer"].includes(resolveRole(message)) ? "system" : "incremental";
      blocks[blockName].push(message);
      assigned.add(message);
    }
    syncBlockIds(blocks);
  }
  notifyCanonicalEntitiesAdded(holder, addedEntities, { operation: "replace" });
  return holder.messages;
}

/**
 * Replace only the materialized model-input projection.
 *
 * messageBlocks remain the authoritative partition and are intentionally not
 * rewritten. This is used after policy filtering/window resolution, where the
 * final LLM input may omit summarized or out-of-window entities without
 * deleting them from the source context blocks.
 */
export function replaceMessageProjection(holder = {}, messages = []) {
  if (!holder || typeof holder !== "object") return [];
  const store = holder.messageStore && typeof holder.messageStore === "object"
    ? resolveStore(holder)
    : (canonicalizeMessageStore(holder) || resolveStore(holder));
  const canonicalMessages = canonicalizeList(store, messages);
  if (!Array.isArray(holder.messages)) holder.messages = [];
  holder.messages.splice(0, holder.messages.length, ...canonicalMessages);
  return holder.messages;
}

export function pruneSummarizedIncrementalMessages(holder = {}) {
  if (!holder || typeof holder !== "object") return 0;
  const keepActive = (message = {}) => !isSummarized(message);
  const messages = Array.isArray(holder.messages) ? holder.messages : [];
  const blocks =
    holder.messageBlocks && typeof holder.messageBlocks === "object" && !Array.isArray(holder.messageBlocks)
      ? holder.messageBlocks
      : null;
  const incremental = blocks && Array.isArray(blocks.incremental) ? blocks.incremental : [];
  const retainedMessages = messages.filter(keepActive);
  const retainedIncremental = incremental.filter(keepActive);
  const removedCount = incremental.length - retainedIncremental.length;

  messages.splice(0, messages.length, ...retainedMessages);
  if (blocks) {
    blocks.incremental.splice(0, blocks.incremental.length, ...retainedIncremental);
    syncBlockIds(blocks);
  }

  holder.messageStore = {
    messages: [],
    byId: new Map(),
    nextId: 1,
  };
  canonicalizeMessageStore(holder);
  return removedCount;
}

export function writeMessageBlocks(holder = {}, blocks = {}) {
  if (!holder || typeof holder !== "object") return null;
  const existing =
    holder.messageBlocks && typeof holder.messageBlocks === "object" && !Array.isArray(holder.messageBlocks)
      ? holder.messageBlocks
      : {};
  const store = holder.messageStore && typeof holder.messageStore === "object"
    ? resolveStore(holder)
    : (canonicalizeMessageStore(holder) || resolveStore(holder));
  const addedEntities = prepareNewCanonicalEntities(holder, store, [
    ...normalizeList(blocks.system),
    ...normalizeList(blocks.history),
    ...normalizeList(blocks.incremental),
  ]);
  reserveExplicitMessageIds(store, [blocks.system, blocks.history, blocks.incremental]);
  for (const blockName of ["system", "history", "incremental"]) {
    if (Object.prototype.hasOwnProperty.call(blocks, blockName)) {
      existing[blockName] = canonicalizeList(store, blocks[blockName]);
    } else if (!Array.isArray(existing[blockName])) {
      existing[blockName] = [];
    }
  }
  syncBlockIds(existing);
  holder.messageBlocks = existing;
  const projected = [];
  const seen = new Set();
  for (const blockName of ["system", "history", "incremental"]) {
    for (const message of normalizeList(existing[blockName])) {
      if (seen.has(message)) continue;
      seen.add(message);
      projected.push(message);
    }
  }
  if (!Array.isArray(holder.messages)) holder.messages = [];
  holder.messages.splice(0, holder.messages.length, ...projected);
  notifyCanonicalEntitiesAdded(holder, addedEntities, { operation: "write_blocks" });
  return existing;
}

export function appendMessage(holder = {}, message = {}, { block = "" } = {}) {
  if (!holder || typeof holder !== "object") return message;
  const store = canonicalizeMessageStore(holder) || resolveStore(holder);
  const isNewEntity = !isKnownCanonicalEntity(store, message);
  if (isNewEntity) applyActiveTurnIdentity(holder, message);
  // Appends create a new entity unless the producer supplied a stable Noobot message id.
  // Content-based matching is restricted to list hydration in canonicalizeList.
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
  if (isNewEntity) {
    notifyCanonicalEntitiesAdded(holder, [canonicalMessage], {
      operation: "append",
      block: blockName,
    });
  }
  return canonicalMessage;
}
