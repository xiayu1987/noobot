/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, isCanonicalText } from "@noobot/shared/value";

export function createSessionExecutionMessageSource({ sessionId, dialogProcessId, turnScopeId }) {
  const source = { sessionId, dialogProcessId, turnScopeId };
  if (!Object.values(source).every(isCanonicalText)) {
    throw Object.assign(
      new TypeError("execution message source requires canonical scope identity"),
      {
        code: "SESSION_EXECUTION_RESULT_INVALID",
      },
    );
  }
  return Object.freeze(source);
}

export function assertSessionExecutionResult(result) {
  const valid =
    isPlainObject(result) &&
    typeof result.answer === "string" &&
    Array.isArray(result.traces) &&
    !Object.hasOwn(result, "messages") &&
    isPlainObject(result.messageSource) &&
    Object.keys(result.messageSource).length === 3 &&
    ["sessionId", "dialogProcessId", "turnScopeId"].every(
      (key) =>
        isCanonicalText(result.messageSource[key]) && result.messageSource[key] === result[key],
    ) &&
    Array.isArray(result.transferEnvelopes) &&
    isCanonicalText(result.dialogProcessId);
  if (!valid) {
    const error = new TypeError(
      "session execution result requires answer, traces, messageSource matching its scope and transferEnvelopes; inline messages are forbidden",
    );
    error.code = "SESSION_EXECUTION_RESULT_INVALID";
    throw error;
  }
  return result;
}
