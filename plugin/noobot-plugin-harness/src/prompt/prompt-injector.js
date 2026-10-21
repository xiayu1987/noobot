/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  buildHarnessInjectedRecord,
  harnessPromptInjectedMessageType,
  isAnyHarnessPromptMessage,
  isHarnessPromptMessage,
  persistHarnessRecordToCurrentTurn,
} from "../capabilities/handlers/shared/message/injected-message-utils.js";
import { projectSessionRecordToContextMessage } from "@noobot/context-protocol/message/session-projection";
import {
  getMessageId,
  replaceMessageProjection,
  resolveModelMessageBlocks,
  resolveModelMessages,
  writeMessageBlocks,
} from "../core/message-store.js";
import {
  isContextSystemMessage,
  resolveContextInjectedMessageType,
} from "@noobot/context-protocol/message/codec";
import { text } from "@noobot/shared/value";

const injectedPromptCache = new WeakMap();

function scanInjectedPromptTypes(message = {}, target = new Set()) {
  if (isAnyHarnessPromptMessage(message)) target.add(resolveContextInjectedMessageType(message));
  return target;
}

function rebuildInjectedPromptCache(messages = []) {
  const types = new Set();
  for (const msg of messages) {
    scanInjectedPromptTypes(msg, types);
  }
  const entry = { types, scannedLength: messages.length };
  injectedPromptCache.set(messages, entry);
  return entry;
}

function getOrCreateInjectedPromptCache(messages = []) {
  const current = injectedPromptCache.get(messages);
  if (!current) return rebuildInjectedPromptCache(messages);
  const scannedLength = Number.isFinite(Number(current.scannedLength))
    ? Number(current.scannedLength)
    : 0;
  const types = current.types instanceof Set ? current.types : new Set();
  if (messages.length < scannedLength) return rebuildInjectedPromptCache(messages);
  if (messages.length > scannedLength) {
    for (let index = scannedLength; index < messages.length; index += 1) {
      scanInjectedPromptTypes(messages[index], types);
    }
    current.types = types;
    current.scannedLength = messages.length;
  }
  return current;
}

export function isHarnessPromptAlreadyInjected(messages = [], id = "") {
  if (!id) return false;
  if (!Array.isArray(messages)) return false;
  const cache = getOrCreateInjectedPromptCache(messages);
  const promptType = harnessPromptInjectedMessageType(id);
  if (cache.types.has(promptType)) return true;
  const found = messages.some((msg) => isHarnessPromptMessage(msg, id));
  if (found) {
    cache.types.add(promptType);
    cache.scannedLength = messages.length;
  }
  return found;
}

function normalizePromptEntries(prompts = []) {
  return (Array.isArray(prompts) ? prompts : [])
    .map((item = {}) => ({
      id: text(item?.id),
      content: String(item?.content || ""),
      priority: Number.isFinite(Number(item?.priority)) ? Number(item.priority) : 50,
      mode: (text(item?.mode) || "prepend").toLowerCase(),
    }))
    .filter((item) => item.id && item.content);
}

function isPromptMessage(message = {}, id = "") {
  const promptId = text(id);
  if (!promptId) return false;
  return isHarnessPromptMessage(message, promptId);
}

function removePromptMessagesFromList(messages = [], id = "", { removeSystem = false } = {}) {
  if (!Array.isArray(messages)) return 0;
  let removed = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] || {};
    if (!isPromptMessage(message, id)) continue;
    if (!removeSystem && isContextSystemMessage(message)) continue;
    messages.splice(index, 1);
    removed += 1;
  }
  if (removed) rebuildInjectedPromptCache(messages);
  return removed;
}

function normalizeSystemPromptPlacement(ctx = {}, id = "") {
  const promptId = text(id);
  if (!promptId) return;
  removePromptMessagesFromList(resolveModelMessages(ctx), promptId, { removeSystem: false });
  const blocks = resolveModelMessageBlocks(ctx);
  removePromptMessagesFromList(blocks.history, promptId, { removeSystem: true });
  removePromptMessagesFromList(blocks.incremental, promptId, { removeSystem: true });
  removePromptMessagesFromList(blocks.system, promptId, { removeSystem: false });
}

function syncSystemPromptMessagesToBlocks(ctx = {}, promptMessages = [], ids = new Set()) {
  const blocks = resolveModelMessageBlocks(ctx);
  const promptIdSet = ids instanceof Set ? ids : new Set(Array.isArray(ids) ? ids : []);
  if (!promptIdSet.size) return 0;
  const nextBlocks = {
    system: Array.isArray(blocks.system) ? [...blocks.system] : [],
    history: Array.isArray(blocks.history) ? [...blocks.history] : [],
    incremental: Array.isArray(blocks.incremental) ? [...blocks.incremental] : [],
  };

  let changed = 0;
  for (const id of promptIdSet) {
    changed += removePromptMessagesFromList(nextBlocks.history, id, { removeSystem: true });
    changed += removePromptMessagesFromList(nextBlocks.incremental, id, { removeSystem: true });
    const existingSystem = nextBlocks.system.find((message) => isPromptMessage(message, id));
    if (existingSystem) continue;
    const source = (Array.isArray(promptMessages) ? promptMessages : []).find(
      (message) => isPromptMessage(message, id) && isContextSystemMessage(message),
    );
    if (!source) continue;
    nextBlocks.system = [...nextBlocks.system, source];
    changed += 1;
  }
  if (changed) {
    writeMessageBlocks(ctx, nextBlocks);
    rebuildInjectedPromptCache(resolveModelMessageBlocks(ctx).system);
  }
  return changed;
}

function commitPromptMessages(
  ctx = {},
  nextMessages = [],
  promptMessages = [],
  { replaceExisting = false } = {},
) {
  const blocks = resolveModelMessageBlocks(ctx);
  const keep = (message) => !(replaceExisting && isAnyHarnessPromptMessage(message));
  const nextBlocks = {
    system: (blocks.system || []).filter(keep),
    history: [...(blocks.history || [])],
    incremental: (blocks.incremental || []).filter(keep),
  };
  for (const message of promptMessages) {
    nextBlocks[isContextSystemMessage(message) ? "system" : "incremental"].push(message);
  }
  writeMessageBlocks(ctx, nextBlocks);
  const committedByUid = new Map();
  for (const blockName of ["system", "incremental"]) {
    for (const message of resolveModelMessageBlocks(ctx)[blockName]) {
      const messageUid = getMessageId(message);
      if (messageUid) committedByUid.set(messageUid, message);
    }
  }
  replaceMessageProjection(
    ctx,
    nextMessages.map((message) => committedByUid.get(getMessageId(message)) || message),
  );
}

function findAfterLeadingSystemIndex(messages = []) {
  let index = 0;
  while (index < messages.length && isContextSystemMessage(messages[index])) {
    index += 1;
  }
  return index;
}

function persistPromptRecordsToCurrentTurn(ctx = {}, promptRecords = []) {
  let count = 0;
  for (const record of promptRecords) {
    if (persistHarnessRecordToCurrentTurn(ctx, record, true)) count += 1;
  }
  return count;
}

export function injectSystemMessages(ctx = {}, options = {}) {
  const messages = resolveModelMessages(ctx);

  const promptEntries = normalizePromptEntries(options?.prompts);
  if (!promptEntries.length) return false;

  const systemBlockIds =
    options.systemBlockIds instanceof Set
      ? options.systemBlockIds
      : new Set(Array.isArray(options.systemBlockIds) ? options.systemBlockIds : []);
  for (const id of systemBlockIds) {
    normalizeSystemPromptPlacement(ctx, id);
  }

  let nextMessages = [...messages];

  let injected = false;
  let replaceExisting = false;
  const cache = getOrCreateInjectedPromptCache(messages);
  const existingTypes = cache.types;

  const sorted = promptEntries
    .filter(
      (item) =>
        item.mode === "replace" || !existingTypes.has(harnessPromptInjectedMessageType(item.id)),
    )
    .sort((a, b) => b.priority - a.priority);

  const prependItems = [];
  const afterSystemItems = [];
  const appendItems = [];

  const promptRecords = [];
  const buildPromptMessage = (id, promptContent) => {
    const record = buildHarnessInjectedRecord(promptContent, {
      injectedMessageType: harnessPromptInjectedMessageType(id),
    });
    promptRecords.push(record);
    return projectSessionRecordToContextMessage(record);
  };
  for (const { id, content, mode } of sorted) {
    if (options.skipIds?.has(id)) continue;

    const promptContent = content;
    if (mode === "replace") {
      replaceExisting = true;
      nextMessages = nextMessages.filter((message) => !isAnyHarnessPromptMessage(message));
      prependItems.push(buildPromptMessage(id, promptContent));
    } else if (mode === "append") {
      appendItems.push(buildPromptMessage(id, promptContent));
    } else if (mode === "after_system") {
      afterSystemItems.push(buildPromptMessage(id, promptContent));
    } else {
      prependItems.push(buildPromptMessage(id, promptContent));
    }
    injected = true;
  }

  for (const item of prependItems.reverse()) {
    nextMessages.unshift(item);
  }

  for (const item of afterSystemItems.reverse()) {
    nextMessages.splice(findAfterLeadingSystemIndex(nextMessages), 0, item);
  }

  for (const item of appendItems) {
    nextMessages.push(item);
  }
  const promptMessages = [...prependItems, ...afterSystemItems, ...appendItems];
  if (injected) commitPromptMessages(ctx, nextMessages, promptMessages, { replaceExisting });
  const updatedMessages = resolveModelMessages(ctx);

  if (injected) {
    if (options.persistToCurrentTurn !== false) {
      persistPromptRecordsToCurrentTurn(ctx, promptRecords);
    }
    rebuildInjectedPromptCache(updatedMessages);
  }

  if (options.syncMessageBlocksSystem === true && systemBlockIds.size) {
    const syncSource = injected
      ? promptMessages
      : updatedMessages.filter(
          (message) =>
            isContextSystemMessage(message) &&
            Array.from(systemBlockIds).some((id) => isPromptMessage(message, id)),
        );
    syncSystemPromptMessagesToBlocks(ctx, syncSource, systemBlockIds);
  }

  return injected;
}
