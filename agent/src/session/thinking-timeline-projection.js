/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function normalizeThinkingRoute(value = "") {
  return String(value || "").trim();
}

export function isInjectedThinkingMessage(message = {}) {
  return message?.injectedMessage === true;
}

export function hasThinkingTimeline(message = {}) {
  return Array.isArray(message?.toolTimeline) || Array.isArray(message?.activityTimeline);
}

export function isMessageInThinkingRound(rootMessage = {}, candidateMessage = {}, filters = {}) {
  const turnScopeId = normalizeThinkingRoute(filters.turnScopeId || rootMessage?.turnScopeId);
  if (turnScopeId) {
    return normalizeThinkingRoute(candidateMessage?.turnScopeId) === turnScopeId;
  }
  const dialogProcessId = normalizeThinkingRoute(filters.dialogProcessId || rootMessage?.dialogProcessId);
  if (dialogProcessId) {
    return normalizeThinkingRoute(candidateMessage?.dialogProcessId) === dialogProcessId;
  }
  return candidateMessage === rootMessage;
}

export function selectThinkingRootMessage(messages = [], filters = {}) {
  const hasRouteFilter = Boolean(
    normalizeThinkingRoute(filters.turnScopeId) || normalizeThinkingRoute(filters.dialogProcessId),
  );
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index] || {};
    if (normalizeThinkingRoute(item.role) !== "assistant") continue;
    if (normalizeThinkingRoute(item.type || "message") !== "message") continue;
    if (isInjectedThinkingMessage(item)) continue;
    if (!hasRouteFilter || isMessageInThinkingRound(filters, item, filters)) return item;
  }
  return {};
}

function mergeTimeline(messages = [], field, resolveKey) {
  const timeline = [];
  const indexByKey = new Map();
  for (const message of messages) {
    for (const item of Array.isArray(message?.[field]) ? message[field] : []) {
      const key = normalizeThinkingRoute(resolveKey(item));
      if (!key || !indexByKey.has(key)) {
        if (key) indexByKey.set(key, timeline.length);
        timeline.push(item);
        continue;
      }
      const index = indexByKey.get(key);
      timeline[index] = { ...timeline[index], ...item };
    }
  }
  return timeline;
}

export function projectThinkingTimeline(messages = [], rootMessage = {}, filters = {}) {
  const roundMessages = messages.filter((item) =>
    isMessageInThinkingRound(rootMessage, item, filters),
  );
  const toolTimeline = mergeTimeline(
    roundMessages,
    "toolTimeline",
    (item) => item?.key || item?.toolCallId || item?.tool_call_id,
  );
  const activityTimeline = mergeTimeline(
    roundMessages,
    "activityTimeline",
    (item) => item?.eventId || item?.id,
  );
  return {
    rootMessage,
    roundMessages,
    toolTimeline,
    activityTimeline,
    projectedRootMessage: {
      ...rootMessage,
      toolTimeline,
      activityTimeline,
    },
  };
}

export function projectThinkingDetailRound(messages = [], filters = {}) {
  const rootMessage = selectThinkingRootMessage(messages, filters);
  return projectThinkingTimeline(messages, rootMessage, filters);
}
