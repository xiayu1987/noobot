/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function normalizeExecutionLogEntity(
  executionLog = {},
  now = () => new Date().toISOString(),
) {
  const data = executionLog?.data && typeof executionLog.data === "object" ? executionLog.data : {};
  return {
    userId: String(executionLog?.userId || "").trim(),
    sessionId: String(executionLog?.sessionId || "").trim(),
    parentSessionId: String(executionLog?.parentSessionId || "").trim(),
    dialogProcessId: String(executionLog?.dialogProcessId || "").trim(),
    turnScopeId: String(executionLog?.turnScopeId || "").trim(),
    event: String(executionLog?.event || "").trim(),
    category: String(executionLog?.category || "").trim(),
    type: String(executionLog?.type || "").trim(),
    data,
    ts: String(executionLog?.ts || "").trim() || now(),
  };
}
