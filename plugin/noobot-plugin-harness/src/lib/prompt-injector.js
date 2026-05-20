/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const HARNESS_MARKERS = new Map(); // legacy registry for backward compatibility only

export function isHarnessPromptAlreadyInjected(messages = [], id = "") {
  return messages.some((msg) => {
    const content = typeof msg?.content === "string" ? msg.content : "";
    return content.includes(`<!-- ${id} -->`);
  });
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
