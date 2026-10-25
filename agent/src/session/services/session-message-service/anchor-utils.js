/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text, isPlainObject } from "@noobot/shared/value";

export function normalizeAnchorValue(value = "") {
  return text(value);
}

export function resolveTurnScopeId(message = {}) {
  return normalizeAnchorValue(message?.turnScopeId || "");
}

export function uniqueValues(values = []) {
  return [...new Set(values.map((value) => normalizeAnchorValue(value)).filter(Boolean))];
}

export function createMessageAnchorMatcher(anchor = {}) {
  const turnScopeId = normalizeAnchorValue(anchor?.turnScopeId);
  if (turnScopeId) {
    return (messageItem) => resolveTurnScopeId(messageItem) === turnScopeId;
  }
  return null;
}

export function resolveUserTurnStartIndex(messages = [], anchorIndex = -1) {
  if (anchorIndex < 0) return -1;
  for (let index = anchorIndex; index >= 0; index -= 1) {
    if (normalizeAnchorValue(messages[index]?.role) === "user") return index;
  }
  return anchorIndex;
}

export function clearReplacementUserRuntimeState(message = {}) {
  if (!isPlainObject(message)) return {};
  const nextMessage = { ...message };
  for (const key of [
    "channelState",
    "error",
    "status",
    "terminalOutcome",
    "state",
    "thinkingFinishedAt",
    "thinkingStartedAt",
    "__noobotRuntimeRunStateKey",
  ]) {
    delete nextMessage[key];
  }
  return nextMessage;
}
