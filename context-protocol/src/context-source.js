/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveModelHistoryMessages } from "./window-reducer.js";
import { projectTerminalHistoryMessages } from "./terminal-history-policy.js";
import { excludeActiveContextScopeItems } from "./context-scope.js";

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function revisionOf(value) {
  let hash = 2166136261;
  for (const character of stableValue(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `ctxsrc:${(hash >>> 0).toString(16)}`;
}

export function createContextSourceSnapshot({ messages = [], turnStatuses = [], revision = "" } = {}) {
  const source = {
    messages: Array.isArray(messages) ? messages : [],
    turnStatuses: Array.isArray(turnStatuses) ? turnStatuses : [],
  };
  return Object.freeze({
    ...source,
    revision: String(revision || revisionOf(source)).trim(),
  });
}

export function projectContextSource({
  source = {},
  scope = {},
  historyLimit = Number.POSITIVE_INFINITY,
} = {}) {
  const snapshot = createContextSourceSnapshot(source);
  const messages = excludeActiveContextScopeItems(snapshot.messages, scope);
  const turnStatuses = excludeActiveContextScopeItems(snapshot.turnStatuses, scope);
  const terminalHistoryMessages = projectTerminalHistoryMessages({ messages, turnStatuses });
  return Object.freeze({
    sourceRevision: snapshot.revision,
    scope,
    messages: resolveModelHistoryMessages({
      sourceMessages: terminalHistoryMessages,
      historyLimit,
    }),
  });
}

