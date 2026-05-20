/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const HARNESS_MARKERS = new Map(); // legacy registry for backward compatibility only

// P2#5: Injected prompt ID cache per messages array reference for O(1) lookup
// WeakMap so it doesn't prevent GC of message arrays
const injectedPromptCache = new WeakMap();

export function isHarnessPromptAlreadyInjected(messages = [], id = "") {
  if (!id) return false;

  // P2#5: Check cache first (O(1))
  if (messages.length > 0) {
    const cache = injectedPromptCache.get(messages);
    if (cache && cache.has(id)) return true;
  }

  // Fallback: scan messages (only on cache miss or first call)
  const found = messages.some((msg) => {
    const content = typeof msg?.content === "string" ? msg.content : "";
    return content.includes(`<!-- ${id} -->`);
  });

  // P2#5: Update cache
  if (found && messages.length > 0) {
    let cache = injectedPromptCache.get(messages);
    if (!cache) {
      cache = new Set();
      injectedPromptCache.set(messages, cache);
    }
    cache.add(id);
  }

  return found;
}

/**
 * P2#5: Mark a prompt as injected without scanning messages.
 * Call this after successful injection to update the O(1) cache.
 */
export function markPromptAsInjected(messages, id) {
  if (!messages || !id || messages.length === 0) return;
  let cache = injectedPromptCache.get(messages);
  if (!cache) {
    cache = new Set();
    injectedPromptCache.set(messages, cache);
  }
  cache.add(id);
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

/**
 * Inject system messages based on registered prompts.
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
  const existingIds = new Set();

  // Collect already-injected IDs
  for (const msg of messages) {
    const content = typeof msg?.content === "string" ? msg.content : "";
    for (const prompt of promptEntries) {
      const id = prompt.id;
      if (content.includes(`<!-- ${id} -->`)) {
        existingIds.add(id);
      }
    }
  }

  // Sort by priority (descending)
  const sorted = promptEntries
    .filter((item) => !existingIds.has(item.id))
    .sort((a, b) => b.priority - a.priority);

  const prependItems = [];
  const appendItems = [];

  for (const { id, content, mode } of sorted) {
    if (options.skipIds?.has(id)) continue;

    const marker = `<!-- ${id} -->\n${content}`;
    if (mode === "replace") {
      // Replace: remove existing harness prompts and add this one
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role === "system" && messages[i].content.startsWith("<!-- noobot-harness")) {
          messages.splice(i, 1);
        }
      }
      prependItems.push({ role: "system", content: marker });
    } else if (mode === "append") {
      appendItems.push({ role: "system", content: marker });
    } else {
      // prepend (default)
      prependItems.push({ role: "system", content: marker });
    }
    injected = true;
  }

  // Apply prepend items (highest priority first)
  for (const item of prependItems.reverse()) {
    messages.unshift(item);
  }

  // Apply append items
  for (const item of appendItems) {
    messages.push(item);
  }

  // P2#5: Update cache for newly injected IDs
  if (injected) {
    let cache = injectedPromptCache.get(messages);
    if (!cache) {
      cache = new Set();
      injectedPromptCache.set(messages, cache);
    }
    for (const { id } of sorted) {
      if (!options.skipIds?.has(id)) {
        cache.add(id);
      }
    }
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
