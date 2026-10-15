/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

export function normalizeExecutionLogEntity(
  executionLog = {},
  now = () => new Date().toISOString(),
) {
  const data = executionLog?.data && typeof executionLog.data === "object" ? executionLog.data : {};
  return {
    userId: text(executionLog?.userId),
    sessionId: text(executionLog?.sessionId),
    parentSessionId: text(executionLog?.parentSessionId),
    dialogProcessId: text(executionLog?.dialogProcessId),
    turnScopeId: text(executionLog?.turnScopeId),
    event: text(executionLog?.event),
    category: text(executionLog?.category),
    type: text(executionLog?.type),
    data,
    ts: text(executionLog?.ts) || now(),
  };
}
