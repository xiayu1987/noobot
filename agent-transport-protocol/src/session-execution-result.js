/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, isCanonicalText } from "@noobot/shared/value";

export function assertSessionExecutionResult(result) {
  const valid =
    isPlainObject(result) &&
    typeof result.answer === "string" &&
    Array.isArray(result.traces) &&
    Array.isArray(result.messages) &&
    result.messages.every(
      (message) => isPlainObject(message) && isCanonicalText(message.messageUid),
    ) &&
    isCanonicalText(result.dialogProcessId);
  if (!valid) {
    const error = new TypeError(
      "session execution result requires answer, traces, messages with messageUid and dialogProcessId",
    );
    error.code = "SESSION_EXECUTION_RESULT_INVALID";
    throw error;
  }
  return result;
}
