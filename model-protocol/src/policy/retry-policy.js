/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MODEL_OPERATION_KIND } from "../protocol/operation.js";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { MODEL_ERROR_CODE } from "../protocol/constants.js";
import { isPlainObject } from "@noobot/shared/value";

function defaultRetryPolicy(operationKind) {
  return Object.freeze({
    transport: Object.freeze({
      maxAttempts:
        operationKind === MODEL_OPERATION_KIND.MEDIA_GENERATION
          ? TURN_THRESHOLDS.model.generationMaxAttempts
          : TURN_THRESHOLDS.model.transportMaxAttempts,
      baseDelayMs: TIME_THRESHOLDS.model.transportRetryBaseDelayMs,
    }),
    reasoningOnly: Object.freeze({ maxAttempts: TURN_THRESHOLDS.model.reasoningOnlyMaxAttempts }),
    emptyResponse: Object.freeze({
      maxAttempts: TURN_THRESHOLDS.model.emptyResponseMaxAttempts,
      baseDelayMs: TIME_THRESHOLDS.model.emptyResponseRetryBaseDelayMs,
    }),
    toolCallMismatch: Object.freeze({
      maxAttempts: TURN_THRESHOLDS.model.toolCallMismatchMaxAttempts,
    }),
    maxTotalAttempts:
      operationKind === MODEL_OPERATION_KIND.MEDIA_GENERATION
        ? TURN_THRESHOLDS.model.generationMaxAttempts
        : TURN_THRESHOLDS.model.maxTotalAttempts,
  });
}

const RETRY_POLICY_FIELDS = new Set([
  "transport",
  "maxTotalAttempts",
  "reasoningOnly",
  "emptyResponse",
  "toolCallMismatch",
]);

const NO_FINAL_RESPONSE_ERROR_CODES = Object.freeze([
  MODEL_ERROR_CODE.EMPTY_RESPONSE_RETRY_EXHAUSTED,
  MODEL_ERROR_CODE.REASONING_RETRY_EXHAUSTED,
]);

export function isNoFinalResponseError(error) {
  return NO_FINAL_RESPONSE_ERROR_CODES.includes(error?.code);
}

export function buildNoFinalResponseRetryPolicy(attemptPolicy = {}) {
  return Object.freeze({
    emptyResponse: attemptPolicy,
    reasoningOnly: attemptPolicy,
  });
}

function requireAttemptCount(value, field) {
  if (!Number.isInteger(value) || value < 1)
    throw new TypeError(`${field} must be a positive integer`);
  return value;
}

function requireDelayMs(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new TypeError(`${field} must be a finite non-negative number`);
  return value;
}

function normalizeAttemptPolicy(defaults, input, field) {
  if (input === undefined) return defaults;
  if (!isPlainObject(input)) throw new TypeError(`${field} must be an object`);
  for (const key of Object.keys(input))
    if (!Object.hasOwn(defaults, key)) throw new TypeError(`${field}.${key} is not supported`);
  const out = { ...defaults };
  if (input.maxAttempts !== undefined)
    out.maxAttempts = requireAttemptCount(input.maxAttempts, `${field}.maxAttempts`);
  if (input.baseDelayMs !== undefined)
    out.baseDelayMs = requireDelayMs(input.baseDelayMs, `${field}.baseDelayMs`);
  return Object.freeze(out);
}

export function normalizeRetryPolicy(input = {}, operationKind = MODEL_OPERATION_KIND.CHAT) {
  if (!isPlainObject(input)) throw new TypeError("retry policy must be an object");
  for (const key of Object.keys(input))
    if (!RETRY_POLICY_FIELDS.has(key)) throw new TypeError(`retry.${key} is not supported`);
  const DEFAULT_RETRY_POLICY = defaultRetryPolicy(operationKind);
  const transport = normalizeAttemptPolicy(
    DEFAULT_RETRY_POLICY.transport,
    input.transport,
    "retry.transport",
  );
  const maxTotalAttempts =
    input.maxTotalAttempts === undefined
      ? DEFAULT_RETRY_POLICY.maxTotalAttempts
      : requireAttemptCount(input.maxTotalAttempts, "retry.maxTotalAttempts");
  if (operationKind === MODEL_OPERATION_KIND.MEDIA_GENERATION && transport.maxAttempts !== 1)
    throw new TypeError("media generation submissions cannot be retried automatically");
  if (operationKind === MODEL_OPERATION_KIND.MEDIA_GENERATION && maxTotalAttempts !== 1)
    throw new TypeError("media generation total attempt budget must be one");
  return Object.freeze({
    transport,
    maxTotalAttempts,
    reasoningOnly: normalizeAttemptPolicy(
      DEFAULT_RETRY_POLICY.reasoningOnly,
      input.reasoningOnly,
      "retry.reasoningOnly",
    ),
    emptyResponse: normalizeAttemptPolicy(
      DEFAULT_RETRY_POLICY.emptyResponse,
      input.emptyResponse,
      "retry.emptyResponse",
    ),
    toolCallMismatch: normalizeAttemptPolicy(
      DEFAULT_RETRY_POLICY.toolCallMismatch,
      input.toolCallMismatch,
      "retry.toolCallMismatch",
    ),
  });
}
