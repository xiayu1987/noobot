/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  HARNESS_INJECTED_MESSAGE_FLAG_FIELD,
} from "../capabilities/handlers/shared/constants.js";
import {
  buildHarnessInjectedMessage,
  persistHarnessMessageToCurrentTurn,
} from "../capabilities/handlers/shared/message/injected-message-utils.js";
const HARNESS_MARKERS = new Map(); // legacy registry for backward compatibility only

// P2#5: Injected prompt ID cache per messages array reference for O(1) lookup
// WeakMap so it doesn't prevent GC of message arrays
const injectedPromptCache = new WeakMap();
const HARNESS_MARKER_PATTERN = /<!--\s*([^<>]*?)\s*-->/g;

function scanInjectedIdsInContent(content = "", target = new Set()) {
  const text = typeof content === "string" ? content : "";
  if (!text) return target;
  HARNESS_MARKER_PATTERN.lastIndex = 0;
  let matched = HARNESS_MARKER_PATTERN.exec(text);
  while (matched) {
    const id = String(matched?.[1] || "").trim();
    if (id) target.add(id);
    matched = HARNESS_MARKER_PATTERN.exec(text);
  }
  return target;
}

function rebuildInjectedPromptCache(messages = []) {
  const ids = new Set();
  for (const msg of messages) {
    scanInjectedIdsInContent(msg?.content, ids);
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
      scanInjectedIdsInContent(messages[index]?.content, ids);
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
  const found = messages.some((msg) =>
    String(msg?.content || "").includes(`<!-- ${id} -->`),
  );
  if (found) {
    cache.ids.add(id);
    cache.scannedLength = messages.length;
  }
  return found;
}

/**
 * P2#5: Mark a prompt as injected without scanning messages.
 * Call this after successful injection to update the O(1) cache.
 */
export function markPromptAsInjected(messages, id) {
  if (!messages || !id || messages.length === 0 || !Array.isArray(messages)) return;
  const cache = getOrCreateInjectedPromptCache(messages);
  cache.ids.add(id);
  cache.scannedLength = messages.length;
}

export function registerPrompt(id, content, priority = 50, mode = "prepend") {
  HARNESS_MARKERS.set(id, { content, priority, mode });
}

export function getRegisteredPrompts() {
  return Array.from(HARNESS_MARKERS.entries()).map(([id, v]) => ({ id, ...v }));
}

export function clearRegisteredPrompts() {
  HARNESS_MARKERS.clear();
}

function normalizePromptEntries(prompts = []) {
  return (Array.isArray(prompts) ? prompts : [])
    .map((item = {}) => ({
      id: String(item?.id || "").trim(),
      content: String(item?.content || ""),
      priority: Number.isFinite(Number(item?.priority)) ? Number(item.priority) : 50,
      mode: String(item?.mode || "prepend").trim().toLowerCase(),
    }))
    .filter((item) => item.id && item.content);
}

function readLegacyPromptEntries() {
  return Array.from(HARNESS_MARKERS.entries()).map(([id, value = {}]) => ({
    id: String(id || "").trim(),
    content: String(value?.content || ""),
    priority: Number.isFinite(Number(value?.priority)) ? Number(value.priority) : 50,
    mode: String(value?.mode || "prepend").trim().toLowerCase(),
  }));
}

function resolveMessageRole(message = {}) {
  const role = String(message?.role || message?.lc_kwargs?.role || "").trim().toLowerCase();
  if (role) return role;
  const type = String(
    message?.type ||
      message?.lc_kwargs?.type ||
      (typeof message?._getType === "function" ? message._getType() : ""),
  )
    .trim()
    .toLowerCase();
  if (type === "ai") return "assistant";
  if (type === "human") return "user";
  return type;
}

function findAfterLeadingSystemIndex(messages = []) {
  let index = 0;
  while (index < messages.length && resolveMessageRole(messages[index]) === "system") {
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

/**
 * Inject user-role harness messages based on registered prompts.
 * Respects priority and mode. Returns true if any injection occurred.
 */
export function injectSystemMessages(ctx = {}, options = {}) {
  const messages = Array.isArray(ctx.messages) ? ctx.messages : null;
  if (!messages) return false;

  const promptEntries = normalizePromptEntries(
    Array.isArray(options?.prompts) ? options.prompts : readLegacyPromptEntries(),
  );
  if (!promptEntries.length) return false;

  let injected = false;
  const cache = getOrCreateInjectedPromptCache(messages);
  const existingIds = cache.ids;

  // Sort by priority (descending)
  const sorted = promptEntries
    .filter((item) => !existingIds.has(item.id))
    .sort((a, b) => b.priority - a.priority);

  const prependItems = [];
  const afterSystemItems = [];
  const appendItems = [];

  for (const { id, content, mode } of sorted) {
    if (options.skipIds?.has(id)) continue;

    const marker = `<!-- ${id} -->\n${content}`;
    if (mode === "replace") {
      // Replace: remove existing harness prompts and add this one
      for (let i = messages.length - 1; i >= 0; i--) {
        if (
          (messages[i]?.[HARNESS_INJECTED_MESSAGE_FLAG_FIELD] === true || messages[i]?.role === "system") &&
          String(messages[i]?.content || "").startsWith("<!-- noobot-harness")
        ) {
          messages.splice(i, 1);
        }
      }
      prependItems.push(buildHarnessInjectedMessage(marker));
    } else if (mode === "append") {
      appendItems.push(buildHarnessInjectedMessage(marker));
    } else if (mode === "after_system") {
      afterSystemItems.push(buildHarnessInjectedMessage(marker));
    } else {
      // prepend (default)
      prependItems.push(buildHarnessInjectedMessage(marker));
    }
    injected = true;
  }

  // Apply prepend items (highest priority first)
  for (const item of prependItems.reverse()) {
    messages.unshift(item);
  }

  for (const item of afterSystemItems.reverse()) {
    messages.splice(findAfterLeadingSystemIndex(messages), 0, item);
  }

  // Apply append items
  for (const item of appendItems) {
    messages.push(item);
  }

  if (injected) {
    persistPromptMessagesToCurrentTurn(ctx, [...prependItems, ...afterSystemItems, ...appendItems]);
    // P2#5: refresh cache once to keep replace/remove semantics consistent
    rebuildInjectedPromptCache(messages);
  }

  return injected;
}

/**
 * Simple single-prompt injection (backward compatible).
 */
export function injectSystemMessage(ctx = {}, content = "", id = "noobot-harness", priority = 50, mode = "prepend") {
  if (!content) return false;
  return injectSystemMessages(ctx, {
    skipIds: new Set(),
    prompts: [{ id, content, priority, mode }],
  });
}
