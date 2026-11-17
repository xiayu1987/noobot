/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveModelHistoryMessages, isModelHistorySourceMessage } from "../policy/window.js";
import {
  projectTerminalHistoryMessages,
  isTerminalHistorySourceCandidate,
} from "../policy/terminal-history.js";
import { excludeActiveContextScopeItems } from "./scope.js";
import { projectTurnTerminalStatuses } from "@noobot/session-protocol";
import {
  projectSessionRecordSelectionMetadata,
  projectSessionRecordsToContextMessages,
} from "../message/session-projection.js";
import { readContextMessageField } from "../message/codec.js";

export function isContextSourceMessageCandidate(record) {
  const message = projectSessionRecordSelectionMetadata(record);
  return isTerminalHistorySourceCandidate(message) || isModelHistorySourceMessage(message);
}

export function selectContextSourceMessageUids(options) {
  return new Set(
    projectContextSource(options).messages.flatMap((message) => {
      const uid = readContextMessageField(message, "messageUid");
      return uid === undefined ? [] : [uid];
    }),
  );
}

export function projectContextSource({ source, scope, historyLimit }) {
  const messages = projectSessionRecordsToContextMessages(
    excludeActiveContextScopeItems(source.messages, scope),
  );
  const terminalStatuses = excludeActiveContextScopeItems(
    projectTurnTerminalStatuses(source.turnLifecycle),
    scope,
  );
  const terminalHistoryMessages = projectTerminalHistoryMessages({ messages, terminalStatuses });
  return Object.freeze({
    scope,
    messages: resolveModelHistoryMessages({
      sourceMessages: terminalHistoryMessages,
      historyLimit,
    }),
  });
}

function selectLifecycleTurns(turnLifecycle, items) {
  const scopes = new Set(items.map((item) => item.turnScopeId));
  return {
    ...turnLifecycle,
    turns: Object.fromEntries(
      Object.entries(turnLifecycle.turns).filter(([scopeId]) => scopes.has(scopeId)),
    ),
  };
}

export async function readContextWindowSource({
  turnOrder,
  turnLifecycle,
  scope,
  historyLimit,
  readTurnMessages,
}) {
  if (!Number.isInteger(historyLimit) || historyLimit < 0)
    throw new TypeError("Context history window requires a nonnegative integer limit");
  const groups = new Map();
  for (const item of excludeActiveContextScopeItems(turnOrder, scope)) {
    const group = groups.get(item.dialogProcessId) || [];
    group.push(item);
    groups.set(item.dialogProcessId, group);
  }
  const retained = [];
  const selected = [];
  for (const items of [...groups.values()].reverse()) {
    if (retained.length >= historyLimit) break;
    const messages = await readTurnMessages(items);
    const source = { messages, turnLifecycle: selectLifecycleTurns(turnLifecycle, items) };
    if (!projectContextSource({ source, scope, historyLimit }).messages.length) continue;
    retained.unshift(messages);
    selected.push(...items);
  }
  return {
    messages: retained.flat(),
    turnLifecycle: selectLifecycleTurns(turnLifecycle, selected),
  };
}
