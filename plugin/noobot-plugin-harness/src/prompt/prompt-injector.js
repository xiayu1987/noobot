/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  buildHarnessInjectedMessage,
  persistHarnessMessageToCurrentTurn,
  resolvePromptInjectionId as resolvePromptInjectionIdFromMetadata,
} from "../capabilities/handlers/shared/message/injected-message-utils.js";
import {
  replaceMessageProjection,
  resolveModelMessageBlocks,
  resolveModelMessages,
  writeMessageBlocks,
} from "../core/message-store.js";
import { isContextSystemMessage } from "@noobot/context-protocol/message/codec";
import { isPlainObject, text } from "@noobot/shared/value";

const injectedPromptCache = new WeakMap();

function scanInjectedIdsInMessage(message = {}, target = new Set()) {
  const metadataId = resolvePromptInjectionIdFromMetadata(message);
  if (metadataId) target.add(metadataId);
  return target;
}

function rebuildInjectedPromptCache(messages = []) {
  const ids = new Set();
  for (const msg of messages) {
    scanInjectedIdsInMessage(msg, ids);
  }
  const entry = { ids, scannedLength: messages.length };
  injectedPromptCache.set(messages, entry);
  return entry;
}

function getOrCreateInjectedPromptCache(messages = []) {
  const current = injectedPromptCache.get(messages);
  if (!current) return rebuildInjectedPromptCache(messages);
  const scannedLength = Number.isFinite(Number(current.scannedLength))
    ? Number(current.scannedLength)
    : 0;
  const ids = current.ids instanceof Set ? current.ids : new Set();
  if (messages.length < scannedLength) return rebuildInjectedPromptCache(messages);
  if (messages.length > scannedLength) {
    for (let index = scannedLength; index < messages.length; index += 1) {
      scanInjectedIdsInMessage(messages[index], ids);
    }
    current.ids = ids;
    current.scannedLength = messages.length;
  }
  return current;
}

export function isHarnessPromptAlreadyInjected(messages = [], id = "") {
  if (!id) return false;
  if (!Array.isArray(messages)) return false;
  const cache = getOrCreateInjectedPromptCache(messages);
  if (cache.ids.has(id)) return true;
  const found = messages.some((msg) => resolvePromptInjectionIdFromMetadata(msg) === id);
  if (found) {
    cache.ids.add(id);
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
      mode: String(item?.mode || "prepend")
        .trim()
        .toLowerCase(),
      messageBlockPolicy: isPlainObject(item?.messageBlockPolicy)
        ? { ...item.messageBlockPolicy }
        : null,
    }))
    .filter((item) => item.id && item.content);
}

function isPromptMessage(message = {}, id = "") {
  const promptId = text(id);
  if (!promptId) return false;
  return resolvePromptInjectionIdFromMetadata(message) === promptId;
}

function isAnyPromptInjectionMessage(message = {}) {
  return !!resolvePromptInjectionIdFromMetadata(message);
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
  const keep = (message) => !(replaceExisting && isAnyPromptInjectionMessage(message));
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
      if (message?.messageUid) committedByUid.set(message.messageUid, message);
    }
  }
  replaceMessageProjection(
    ctx,
    nextMessages.map((message) => committedByUid.get(message?.messageUid) || message),
  );
}

function findAfterLeadingSystemIndex(messages = []) {
  let index = 0;
  while (index < messages.length && isContextSystemMessage(messages[index])) {
    index += 1;
  }
  return index;
}

function persistPromptMessagesToCurrentTurn(ctx = {}, promptMessages = []) {
  let count = 0;
  for (const message of Array.isArray(promptMessages) ? promptMessages : []) {
    if (persistHarnessMessageToCurrentTurn(ctx, message, true)) count += 1;
  }
  return count;
}

export function injectSystemMessages(ctx = {}, options = {}) {
  const messages = resolveModelMessages(ctx);
  let nextMessages = [...messages];

  const promptEntries = normalizePromptEntries(options?.prompts);
  if (!promptEntries.length) return false;

  const systemBlockIds =
    options.systemBlockIds instanceof Set
      ? options.systemBlockIds
      : new Set(Array.isArray(options.systemBlockIds) ? options.systemBlockIds : []);
  for (const id of systemBlockIds) {
    normalizeSystemPromptPlacement(ctx, id);
  }

  let injected = false;
  let replaceExisting = false;
  const cache = getOrCreateInjectedPromptCache(messages);
  const existingIds = cache.ids;

  const sorted = promptEntries
    .filter((item) => item.mode === "replace" || !existingIds.has(item.id))
    .sort((a, b) => b.priority - a.priority);

  const prependItems = [];
  const afterSystemItems = [];
  const appendItems = [];

  for (const { id, content, mode, messageBlockPolicy } of sorted) {
    if (options.skipIds?.has(id)) continue;

    const promptContent = content;
    if (mode === "replace") {
      replaceExisting = true;
      nextMessages = nextMessages.filter((message) => !isAnyPromptInjectionMessage(message));
      prependItems.push(
        buildHarnessInjectedMessage(promptContent, {
          injectedMessageType: `harness_prompt:${id}`,
          promptInjectionId: id,
          messageBlockPolicy,
        }),
      );
    } else if (mode === "append") {
      appendItems.push(
        buildHarnessInjectedMessage(promptContent, {
          injectedMessageType: `harness_prompt:${id}`,
          promptInjectionId: id,
          messageBlockPolicy,
        }),
      );
    } else if (mode === "after_system") {
      afterSystemItems.push(
        buildHarnessInjectedMessage(promptContent, {
          injectedMessageType: `harness_prompt:${id}`,
          promptInjectionId: id,
          messageBlockPolicy,
        }),
      );
    } else {
      prependItems.push(
        buildHarnessInjectedMessage(promptContent, {
          injectedMessageType: `harness_prompt:${id}`,
          promptInjectionId: id,
          messageBlockPolicy,
        }),
      );
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
      persistPromptMessagesToCurrentTurn(ctx, promptMessages);
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
