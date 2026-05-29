/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Execution log entity normalization.
 */

import { resolveMessageDialogProcessId } from "../../context/session/dialog-process-id-resolver.js";

export function normalizeExecutionLogEntity(
  executionLog = {},
  now = () => new Date().toISOString(),
) {
  return {
    dialogProcessId: resolveMessageDialogProcessId(executionLog),
    event: String(executionLog?.event || "").trim(),
    category: String(executionLog?.category || "").trim(),
    type: String(executionLog?.type || "").trim(),
    data:
      executionLog?.data && typeof executionLog.data === "object"
        ? executionLog.data
        : {},
    ts: String(executionLog?.ts || "").trim() || now(),
  };
}
