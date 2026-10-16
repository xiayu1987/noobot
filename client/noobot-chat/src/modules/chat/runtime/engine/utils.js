/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";

export function normalizeTrimmedString(value) {
  return text(value);
}

export function projectExecutionLogDisplay(logItem = {}) {
  if (logItem.event !== "tool_result") return logItem;
  return {
    ...logItem,
    text: text(logItem.tool),
    statusKey:
      logItem.success === false
        ? "message.executionStatusFailed"
        : "message.executionStatusCompleted",
  };
}
