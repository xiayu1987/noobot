/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveModelHistoryMessages } from "../policy/window.js";
import { projectTerminalHistoryMessages } from "../policy/terminal-history.js";
import { excludeActiveContextScopeItems } from "./scope.js";
import { projectTurnTerminalStatuses } from "@noobot/session-protocol";
import { projectSessionRecordsToContextMessages } from "../message/session-projection.js";

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
