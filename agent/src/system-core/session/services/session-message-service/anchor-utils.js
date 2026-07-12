/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function normalizeAnchorValue(value = "") {
  return String(value || "").trim();
}

export function resolveTurnScopeId(message = {}) {
  return normalizeAnchorValue(message?.turnScopeId || "");
}

export function resolveSessionVersion(session = {}) {
  const version = Number(session?.version ?? session?.revision ?? 0);
  return Number.isFinite(version) ? version : 0;
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
  if (!message || typeof message !== "object" || Array.isArray(message)) return {};
  const nextMessage = { ...message };
  for (const key of [
    "channelState",
    "dialogId",
    "dialog_id",
    "dialog_process_id",
    "status",
    "statusLabel",
    "state",
    "thinkingFinishedAt",
    "thinkingStartedAt",
    "__noobotRuntimeRunStateKey",
  ]) {
    delete nextMessage[key];
  }
  return nextMessage;
}
