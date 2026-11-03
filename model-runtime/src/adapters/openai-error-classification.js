/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { APIConnectionTimeoutError, APIUserAbortError } from "openai";
import { MODEL_ERROR_KIND } from "@noobot/model-protocol";
import { classifyTransportError } from "../policies/default-retry-policy.js";

const RESPONSES_FAILURE_ERROR_NAME = "ResponsesStreamFailedError";

const RETRYABLE_RESPONSES_FAILURE_CODES = new Map([
  ["server_error", MODEL_ERROR_KIND.TEMPORARY_UNAVAILABLE],
  ["rate_limit_exceeded", MODEL_ERROR_KIND.RATE_LIMIT],
]);

export function createResponsesFailureError({ code, message }) {
  const error = new Error(message);
  error.name = RESPONSES_FAILURE_ERROR_NAME;
  error.code = code;
  return error;
}

function classifyResponsesFailure(error) {
  const kind = RETRYABLE_RESPONSES_FAILURE_CODES.get(error.code);
  return kind ? { kind, retryable: true } : { kind: MODEL_ERROR_KIND.UNKNOWN, retryable: false };
}

export function classifyOpenAiError(error) {
  if (error instanceof APIUserAbortError)
    return { kind: MODEL_ERROR_KIND.ABORTED, retryable: false };
  if (error instanceof APIConnectionTimeoutError) {
    return { kind: MODEL_ERROR_KIND.TIMEOUT, retryable: true };
  }
  if (error?.name === RESPONSES_FAILURE_ERROR_NAME) return classifyResponsesFailure(error);
  return classifyTransportError(error);
}
