/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveModelHistoryMessages } from "../policy/window.js";
import { projectTerminalHistoryMessages } from "../policy/terminal-history.js";
import { excludeActiveContextScopeItems } from "./scope.js";
import { projectTurnTerminalStatuses } from "@noobot/session-protocol";

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`)
      .join(",")}}`;
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

export function createContextSourceSnapshot({
  messages = [],
  turnLifecycle = {},
  revision = "",
} = {}) {
  const source = {
    messages: Array.isArray(messages) ? messages : [],
    turnLifecycle: turnLifecycle && typeof turnLifecycle === "object" ? turnLifecycle : {},
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
  const terminalStatuses = excludeActiveContextScopeItems(
    projectTurnTerminalStatuses(snapshot.turnLifecycle),
    scope,
  );
  const terminalHistoryMessages = projectTerminalHistoryMessages({ messages, terminalStatuses });
  return Object.freeze({
    sourceRevision: snapshot.revision,
    scope,
    messages: resolveModelHistoryMessages({
      sourceMessages: terminalHistoryMessages,
      historyLimit,
    }),
  });
}
