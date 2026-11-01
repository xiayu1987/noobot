/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText } from "@noobot/shared/value";
import { resolveExecutionAbortReason } from "./execution-abort.js";

export const TURN_FAILURE_CODE = Object.freeze({
  UNCLASSIFIED_ERROR: "unclassified_error",
});

function requireFailureMessage(value) {
  const message = typeof value === "string" ? value.trim() : "";
  if (!message) throw new TypeError("execution failure requires a non-empty message");
  return message;
}

export function projectExecutionFailure({ error = null, abortSignal = null } = {}) {
  const abortReason = resolveExecutionAbortReason({ error, abortSignal });
  if (abortReason) {
    return { code: abortReason.type, message: requireFailureMessage(abortReason.reason) };
  }
  if (!(error instanceof Error)) {
    throw new TypeError("execution failure requires an Error or a structured abort reason");
  }
  return {
    code: isCanonicalText(error.code) ? error.code : TURN_FAILURE_CODE.UNCLASSIFIED_ERROR,
    message: requireFailureMessage(error.message),
  };
}

export function createTurnFailure({ error = null, abortSignal = null, retryable } = {}) {
  if (typeof retryable !== "boolean") {
    throw new TypeError("turn failure requires an explicit retryable flag");
  }
  return { ...projectExecutionFailure({ error, abortSignal }), retryable };
}
