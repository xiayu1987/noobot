/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  HARNESS_MESSAGE_ORIGIN_FIELD,
  INTERNAL_MESSAGE_FIELDS,
  MESSAGE_ORIGIN_KIND,
  resolveMessageOrigin,
} from "./message-metadata.js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

const MAX_CACHE_ENTRIES = QUANTITY_THRESHOLDS.harness.incrementalMessageCacheEntries;
const capabilityMessageCache = new Map();

function resolveSessionKey(ctx = {}) {
  return String(
    ctx?.sessionId ||
      ctx?.agentContext?.sessionId ||
      ctx?.agentContext?.payload?.sessionId ||
      ctx?.agentContext?.execution?.sessionId ||
      "",
  ).trim();
}

function resolveCacheKey(ctx = {}, purpose = "") {
  const sessionKey = resolveSessionKey(ctx);
  const normalizedPurpose = String(purpose || "").trim() || "unknown";
  if (!sessionKey) return "";
  return `${sessionKey}::${normalizedPurpose}`;
}

function cloneMessage(message = {}) {
  if (!message || typeof message !== "object") return null;
  const role = String(message?.role || "").trim();
  const content = message?.content;
  const cloned = { ...message, role };
  if (Array.isArray(content)) {
    cloned.content = content.map((item) => (
      item && typeof item === "object" ? { ...item } : item
    ));
  }
  if (Array.isArray(message?.tool_calls)) {
    cloned.tool_calls = message.tool_calls.map((item) => (
      item && typeof item === "object" ? { ...item } : item
    ));
  }
  for (const field of INTERNAL_MESSAGE_FIELDS) {
    if (message?.[field] !== undefined) {
      Object.defineProperty(cloned, field, {
        value: message[field],
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }
  }
  return cloned;
}

function sanitizeMessageForProvider(message = {}) {
  const cloned = cloneMessage(message);
  if (!cloned) return null;
  delete cloned[HARNESS_MESSAGE_ORIGIN_FIELD];
  return cloned;
}

function sanitizeMessagesForProvider(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => sanitizeMessageForProvider(message))
    .filter(Boolean);
}

function cloneMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => cloneMessage(message))
    .filter(Boolean);
}

function fingerprintMessage(message = {}) {
  return JSON.stringify({
    role: String(message?.role || "").trim(),
    content: message?.content ?? "",
    tool_calls: Array.isArray(message?.tool_calls) ? message.tool_calls : undefined,
    tool_call_id: message?.tool_call_id || undefined,
  });
}

function countCommonPrefix(left = [], right = []) {
  const max = Math.min(left.length, right.length);
  let index = 0;
  while (index < max && fingerprintMessage(left[index]) === fingerprintMessage(right[index])) {
    index += 1;
  }
  return index;
}

function isSystemLikeMessage(message = {}) {
  const role = String(message?.role || "").trim().toLowerCase();
  return role === "system" || role === "developer";
}

function pruneCacheIfNeeded() {
  while (capabilityMessageCache.size > MAX_CACHE_ENTRIES) {
    const firstKey = capabilityMessageCache.keys().next().value;
    if (!firstKey) break;
    capabilityMessageCache.delete(firstKey);
  }
}

function resolveOriginKeySet(messages = [], kind = "") {
  return new Set(
    (Array.isArray(messages) ? messages : [])
      .map((message) => {
        const origin = resolveMessageOrigin(message);
        if (!origin || (kind && origin.kind !== kind)) return "";
        return origin.key;
      })
      .filter(Boolean),
  );
}

function resolveExplicitIncrementalMessages({
  currentMessages = [],
  previousMessages = [],
} = {}) {
  const previousContextKeys = resolveOriginKeySet(previousMessages, MESSAGE_ORIGIN_KIND.CONTEXT);
  const contextMessages = [];
  const protocolMessages = [];
  const hasOrigins = currentMessages.some((message) => Boolean(resolveMessageOrigin(message)));
  if (!hasOrigins) {
    return null;
  }

  for (const message of currentMessages) {
    const origin = resolveMessageOrigin(message);
    if (!origin) {
      continue;
    }
    if (origin.kind === MESSAGE_ORIGIN_KIND.CONTEXT) {
      if (!previousContextKeys.has(origin.key)) {
        contextMessages.push(message);
      }
      continue;
    }
    if (origin.kind === MESSAGE_ORIGIN_KIND.PROTOCOL) {
      protocolMessages.push(message);
    }
  }

  return {
    messages: [...contextMessages, ...protocolMessages],
  };
}

export function resolveIncrementalCapabilityMessages({
  ctx = {},
  purpose = "",
  messages = [],
} = {}) {
  const currentMessages = cloneMessages(messages);
  const key = resolveCacheKey(ctx, purpose);
  if (!key || !currentMessages.length) return sanitizeMessagesForProvider(currentMessages);

  const previous = capabilityMessageCache.get(key);
  const previousMessages = Array.isArray(previous?.messages) ? previous.messages : [];
  if (!previousMessages.length) {
    capabilityMessageCache.set(key, {
      messages: cloneMessages(currentMessages),
      updatedAt: Date.now(),
    });
    pruneCacheIfNeeded();
    return sanitizeMessagesForProvider(currentMessages);
  }

  const explicitIncremental = resolveExplicitIncrementalMessages({
    currentMessages,
    previousMessages,
  });
  if (explicitIncremental) {
    const resolvedMessages = [
      ...cloneMessages(previousMessages),
      ...cloneMessages(explicitIncremental.messages),
    ];
    capabilityMessageCache.set(key, {
      messages: cloneMessages(resolvedMessages),
      updatedAt: Date.now(),
    });
    pruneCacheIfNeeded();
    return sanitizeMessagesForProvider(resolvedMessages);
  }

  const commonPrefix = countCommonPrefix(previousMessages, currentMessages);
  let resolvedMessages = currentMessages;
  if (commonPrefix <= 0) {
    if (
      isSystemLikeMessage(currentMessages[0]) &&
      isSystemLikeMessage(previousMessages[0]) &&
      fingerprintMessage(currentMessages[0]) !== fingerprintMessage(previousMessages[0])
    ) {
      resolvedMessages = currentMessages;
    } else {
      resolvedMessages = [
        ...cloneMessages(previousMessages),
        ...currentMessages,
      ];
    }
  } else {
    resolvedMessages = [
      ...cloneMessages(previousMessages),
      ...cloneMessages(currentMessages.slice(commonPrefix)),
    ];
  }
  capabilityMessageCache.set(key, {
    messages: cloneMessages(resolvedMessages),
    updatedAt: Date.now(),
  });
  pruneCacheIfNeeded();
  return sanitizeMessagesForProvider(resolvedMessages);
}

export function clearIncrementalCapabilityMessageCacheForContext(ctx = {}) {
  const sessionKey = resolveSessionKey(ctx);
  if (!sessionKey) return 0;
  let deleted = 0;
  for (const key of [...capabilityMessageCache.keys()]) {
    if (key.startsWith(`${sessionKey}::`)) {
      capabilityMessageCache.delete(key);
      deleted += 1;
    }
  }
  return deleted;
}

export function clearIncrementalCapabilityMessageCache() {
  const size = capabilityMessageCache.size;
  capabilityMessageCache.clear();
  return size;
}
