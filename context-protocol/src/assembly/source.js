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
  projectSessionRecordToContextMessage,
} from "../message/session-projection.js";
import { readContextMessageField } from "../message/codec.js";

export function isContextSourceMessageCandidate(record) {
  const message = projectSessionRecordSelectionMetadata(record);
  return isTerminalHistorySourceCandidate(message) || isModelHistorySourceMessage(message);
}

function selectContextSourceMessageUids(options) {
  return new Set(
    projectHistory(options, projectSessionRecordSelectionMetadata).flatMap((message) => {
      const uid = readContextMessageField(message, "messageUid");
      return uid === undefined ? [] : [uid];
    }),
  );
}

function projectHistory({ source, scope, historyLimit }, projectRecord) {
  const messages = excludeActiveContextScopeItems(source.messages, scope).map(projectRecord);
  const terminalStatuses = excludeActiveContextScopeItems(
    projectTurnTerminalStatuses(source.turnLifecycle),
    scope,
  );
  const terminalHistoryMessages = projectTerminalHistoryMessages({ messages, terminalStatuses });
  return resolveModelHistoryMessages({ sourceMessages: terminalHistoryMessages, historyLimit });
}

export function projectContextSource(options) {
  return Object.freeze({
    scope: options.scope,
    messages: projectHistory(options, projectSessionRecordToContextMessage),
  });
}

export async function readIndexedContextWindow({
  scope,
  historyLimit,
  readLifecycle,
  readDialogs,
  readDialog,
}) {
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 0)
    throw new TypeError("Context history window requires a nonnegative safe integer limit");
  const lifecycle = await readLifecycle();
  const retained = [];
  if (historyLimit > 0) {
    for await (const { dialogProcessId, descriptor } of readDialogs()) {
      if (dialogProcessId === scope?.dialogProcessId) continue;
      const source = await readDialog(descriptor);
      const selected = selectContextSourceMessageUids({ source, scope, historyLimit });
      if (!selected.size) continue;
      retained.push({ source, selected });
      if (retained.length === historyLimit) break;
    }
  }
  retained.reverse();
  const messages = [];
  for (const { source, selected } of retained)
    messages.push(...(await source.materialize(selected)));
  return {
    messages,
    turnLifecycle: {
      ...lifecycle,
      turns: Object.fromEntries(
        retained.flatMap(({ source }) => Object.entries(source.turnLifecycle.turns)),
      ),
    },
  };
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
