/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  getModelContextRuntime,
  resetModelContextMessageStore,
} from "../assembly/model-runtime.js";
import {
  isContextSystemMessage,
  markContextMessageSummarized,
  readContextMessageField,
  withContextMessageMetadata,
  resolveContextMessageKey,
  resolveContextMessageRole,
  resolveContextMessageSummarized,
  resolveContextToolCallDeclarationId,
  resolveContextToolResultCallId,
  resolveContextToolCalls,
} from "./codec.js";
import { isPlainObject, text, isObjectLike } from "@noobot/shared/value";

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

const ROUND_IDENTITY_FIELDS = ["dialogProcessId", "turnScopeId"];

function normalizeRoundIdentity(identity = {}) {
  return Object.fromEntries(ROUND_IDENTITY_FIELDS.map((field) => [field, text(identity?.[field])]));
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
    Object.fromEntries(
      ROUND_IDENTITY_FIELDS.map((field) => [field, readContextMessageField(message, field)]),
    ),
  );
  if (!active.dialogProcessId) {
    requireCompleteRoundIdentity(existing, "canonical message round identity");
    return message;
  }
  for (const field of ROUND_IDENTITY_FIELDS) {
    if (existing[field] && existing[field] !== active[field]) {
      throw new Error(`canonical message ${field} conflicts with the active turn identity`);
    }
  }
  return withContextMessageMetadata(message, active);
}

function mergeMessageState(target = {}, source = {}) {
  if (!isObjectLike(target) || !isObjectLike(source)) return target;
  if (resolveContextMessageSummarized(source)) {
    markContextMessageSummarized(target);
  }
  return target;
}

function resolveMessageContent(message = {}) {
  const content = message?.content ?? "";
  return typeof content === "string" ? content : JSON.stringify(content);
}

function resolveToolCallIds(message = {}) {
  return resolveContextToolCalls(message).map(resolveContextToolCallDeclarationId);
}

function canonicalEntityShape(message = {}) {
  return JSON.stringify({
    role: resolveContextMessageRole(message),
    content: resolveMessageContent(message),
    toolCallId: resolveContextToolResultCallId(message),
    toolCallIds: resolveToolCallIds(message),
    internalType: readContextMessageField(message, "noobotInternalMessageType"),
  });
}

function resolveStore(holder = {}) {
  const runtime = getModelContextRuntime(holder);
  const store = runtime.messageStore;
  if (!(store.byId instanceof Map)) store.byId = new Map();
  if (!Array.isArray(store.messages)) store.messages = [];
  return store;
}

function canonicalizeMessage(store = null, message = null) {
  if (!store || !isObjectLike(message)) return message;
  const existingId = resolveContextMessageKey(message);
  if (store.byId.has(existingId)) {
    const existingById = store.byId.get(existingId);
    if (canonicalEntityShape(existingById) !== canonicalEntityShape(message)) {
      throw new Error(`canonical message id collision: ${existingId}`);
    }
    mergeMessageState(existingById, message);
    return existingById;
  }
  store.byId.set(existingId, message);
  store.messages.push(message);
  return message;
}

function canonicalizeList(store = null, messages = []) {
  return normalizeList(messages).map((message) => canonicalizeMessage(store, message));
}

function isKnownCanonicalEntity(store = null, message = {}) {
  if (!store || !isObjectLike(message)) return false;
  if (normalizeList(store.messages).includes(message)) return true;
  return store.byId instanceof Map && store.byId.has(resolveContextMessageKey(message));
}

function prepareNewCanonicalEntities(holder = {}, store = null, messages = []) {
  const addedEntities = [];
  const entitiesBySource = new Map();
  const seen = new Set();
  for (const message of normalizeList(messages)) {
    if (!isObjectLike(message) || seen.has(message)) continue;
    seen.add(message);
    if (isKnownCanonicalEntity(store, message)) {
      entitiesBySource.set(message, message);
      continue;
    }
    const identifiedMessage = applyActiveTurnIdentity(holder, message);
    entitiesBySource.set(message, identifiedMessage);
    addedEntities.push(identifiedMessage);
  }
  return { addedEntities, entitiesBySource };
}

function notifyCanonicalEntitiesAdded(holder = {}, messages = [], meta = {}) {
  const observer = getModelContextRuntime(holder).onCanonicalMessageAdded;
  if (typeof observer !== "function") return;
  for (const message of normalizeList(messages)) {
    observer(message, meta);
  }
}

function syncBlockIds(blocks = null) {
  if (!isPlainObject(blocks)) return blocks;
  for (const staleField of ["system", "history", "incremental"].map((name) => `${name}Ids`)) {
    delete blocks[staleField];
  }
  return blocks;
}

export function canonicalizeMessageStore(holder = {}) {
  if (!isObjectLike(holder)) return null;
  const store = resolveStore(holder);
  const blocks = isPlainObject(holder.messageBlocks) ? holder.messageBlocks : null;
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

export function removeMessagesByIds(holder = {}, messageIds = []) {
  if (!isObjectLike(holder)) {
    throw new TypeError("modelContext document is required");
  }
  const normalizedIds = new Set(
    normalizeList(messageIds)
      .map((value) => text(value))
      .filter(Boolean),
  );
  if (normalizedIds.size === 0) {
    throw new TypeError("messageIds must contain at least one canonical message id");
  }
  const blocks = holder.messageBlocks;
  if (!isPlainObject(blocks)) {
    throw new TypeError("modelContext.messageBlocks is required");
  }

  const removedMessages = [];
  const nextBlocks = {};
  for (const blockName of ["system", "history", "incremental"]) {
    const source = normalizeList(blocks[blockName]);
    nextBlocks[blockName] = source.filter((message) => {
      if (!normalizedIds.has(resolveContextMessageKey(message))) return true;
      removedMessages.push(message);
      return false;
    });
  }
  if (removedMessages.length === 0) {
    return { removedCount: 0, removedMessageKeys: [] };
  }

  writeMessageBlocks(holder, nextBlocks);
  return {
    removedCount: removedMessages.length,
    removedMessageKeys: [...new Set(removedMessages.map(resolveContextMessageKey))],
  };
}

export function resolveMessagesByIds(holder = {}, ids = []) {
  const store = resolveStore(holder);
  return normalizeList(ids)
    .map((id) => store.byId.get(text(id)))
    .filter(Boolean);
}

export function markMessagesSummarizedByIds(holder = {}, ids = []) {
  const messages = resolveMessagesByIds(holder, ids);
  let changedCount = 0;
  for (const message of messages) {
    if (resolveContextMessageSummarized(message)) continue;
    markContextMessageSummarized(message);
    changedCount += 1;
  }
  return changedCount;
}

export function replaceMessages(holder = {}, messages = []) {
  if (!isObjectLike(holder)) return [];
  const store = canonicalizeMessageStore(holder) || resolveStore(holder);
  const prepared = prepareNewCanonicalEntities(holder, store, messages);
  const canonicalMessages = canonicalizeList(
    store,
    normalizeList(messages).map((message) => prepared.entitiesBySource.get(message) || message),
  );
  if (!Array.isArray(holder.messages)) holder.messages = [];
  holder.messages.splice(0, holder.messages.length, ...canonicalMessages);
  const blocks =
    holder.messageBlocks && typeof holder.messageBlocks === "object" ? holder.messageBlocks : null;
  if (blocks) {
    const retained = new Set(canonicalMessages);
    const assigned = new Set();
    for (const blockName of ["system", "history", "incremental"]) {
      const next =
        blockName === "history"
          ? normalizeList(blocks[blockName])
          : normalizeList(blocks[blockName]).filter((message) => retained.has(message));
      blocks[blockName] = next;
      for (const message of next) assigned.add(message);
    }
    for (const message of canonicalMessages) {
      if (assigned.has(message)) continue;
      const blockName = isContextSystemMessage(message) ? "system" : "incremental";
      blocks[blockName].push(message);
      assigned.add(message);
    }
    syncBlockIds(blocks);
  }
  notifyCanonicalEntitiesAdded(holder, prepared.addedEntities, { operation: "replace" });
  return holder.messages;
}

export function replaceMessageProjection(holder = {}, messages = []) {
  if (!isObjectLike(holder)) return [];
  const store = canonicalizeMessageStore(holder) || resolveStore(holder);
  const canonicalMessages = canonicalizeList(store, messages);
  if (!Array.isArray(holder.messages)) holder.messages = [];
  holder.messages.splice(0, holder.messages.length, ...canonicalMessages);
  return holder.messages;
}

export function pruneSummarizedIncrementalMessages(holder = {}) {
  if (!isObjectLike(holder)) return 0;
  const keepActive = (message = {}) => !resolveContextMessageSummarized(message);
  const messages = Array.isArray(holder.messages) ? holder.messages : [];
  const blocks = isPlainObject(holder.messageBlocks) ? holder.messageBlocks : null;
  const incremental = blocks && Array.isArray(blocks.incremental) ? blocks.incremental : [];
  const retainedMessages = messages.filter(keepActive);
  const retainedIncremental = incremental.filter(keepActive);
  const removedCount = incremental.length - retainedIncremental.length;

  messages.splice(0, messages.length, ...retainedMessages);
  if (blocks) {
    blocks.incremental.splice(0, blocks.incremental.length, ...retainedIncremental);
    syncBlockIds(blocks);
  }

  resetModelContextMessageStore(holder);
  canonicalizeMessageStore(holder);
  return removedCount;
}

export function writeMessageBlocks(holder = {}, blocks = {}) {
  if (!isObjectLike(holder)) return null;
  const existing = isPlainObject(holder.messageBlocks) ? holder.messageBlocks : {};
  const store = canonicalizeMessageStore(holder) || resolveStore(holder);
  const prepared = prepareNewCanonicalEntities(holder, store, [
    ...normalizeList(blocks.system),
    ...normalizeList(blocks.history),
    ...normalizeList(blocks.incremental),
  ]);
  for (const blockName of ["system", "history", "incremental"]) {
    if (Object.prototype.hasOwnProperty.call(blocks, blockName)) {
      existing[blockName] = canonicalizeList(
        store,
        normalizeList(blocks[blockName]).map(
          (message) => prepared.entitiesBySource.get(message) || message,
        ),
      );
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
  notifyCanonicalEntitiesAdded(holder, prepared.addedEntities, { operation: "write_blocks" });
  return existing;
}

export function appendMessage(holder = {}, message = {}, { block = "" } = {}) {
  if (!isObjectLike(holder)) return message;
  const store = canonicalizeMessageStore(holder) || resolveStore(holder);
  const isNewEntity = !isKnownCanonicalEntity(store, message);
  const identifiedMessage = isNewEntity ? applyActiveTurnIdentity(holder, message) : message;

  const canonicalMessage = canonicalizeMessage(store, identifiedMessage);
  if (!Array.isArray(holder.messages)) holder.messages = [];
  if (!holder.messages.includes(canonicalMessage)) holder.messages.push(canonicalMessage);
  const blockName = text(block);
  if (["system", "history", "incremental"].includes(blockName)) {
    const currentBlocks = isPlainObject(holder.messageBlocks)
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
