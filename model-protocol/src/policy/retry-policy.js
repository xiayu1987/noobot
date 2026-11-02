/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { MODEL_ERROR_CODE } from "../protocol/constants.js";

function defaultRetryPolicy() {
  return Object.freeze({
    transport: Object.freeze({
      maxAttempts: TURN_THRESHOLDS.model.transportMaxAttempts,
      baseDelayMs: TIME_THRESHOLDS.model.transportRetryBaseDelayMs,
    }),
    reasoningOnly: Object.freeze({ maxAttempts: TURN_THRESHOLDS.model.reasoningOnlyMaxAttempts }),
    emptyResponse: Object.freeze({
      maxAttempts: TURN_THRESHOLDS.model.emptyResponseMaxAttempts,
      baseDelayMs: TIME_THRESHOLDS.model.emptyResponseRetryBaseDelayMs,
    }),
    toolCallMismatch: Object.freeze({
      maxAttempts: TURN_THRESHOLDS.model.toolCallMismatchMaxAttempts,
      downgradeStreaming: true,
    }),
    providerFallback: Object.freeze({ enabled: false, candidates: Object.freeze([]) }),
  });
}

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

function normalizeAttemptPolicy(defaults, input) {
  const source = input && typeof input === "object" ? input : {};
  const maxAttempts = Number(source.maxAttempts ?? defaults.maxAttempts);
  const out = {
    ...defaults,
    ...source,
    maxAttempts: Number.isFinite(maxAttempts)
      ? Math.max(1, Math.floor(maxAttempts))
      : defaults.maxAttempts,
  };
  if ("baseDelayMs" in defaults) {
    const baseDelayMs = Number(source.baseDelayMs ?? defaults.baseDelayMs);
    out.baseDelayMs = Number.isFinite(baseDelayMs)
      ? Math.max(0, baseDelayMs)
      : defaults.baseDelayMs;
  }
  return Object.freeze(out);
}

export function normalizeRetryPolicy(input = {}) {
  const DEFAULT_RETRY_POLICY = defaultRetryPolicy();
  return Object.freeze({
    transport: normalizeAttemptPolicy(DEFAULT_RETRY_POLICY.transport, input.transport),
    reasoningOnly: normalizeAttemptPolicy(DEFAULT_RETRY_POLICY.reasoningOnly, input.reasoningOnly),
    emptyResponse: normalizeAttemptPolicy(DEFAULT_RETRY_POLICY.emptyResponse, input.emptyResponse),
    toolCallMismatch: normalizeAttemptPolicy(
      DEFAULT_RETRY_POLICY.toolCallMismatch,
      input.toolCallMismatch,
    ),
    providerFallback: Object.freeze({
      ...DEFAULT_RETRY_POLICY.providerFallback,
      ...(input.providerFallback && typeof input.providerFallback === "object"
        ? input.providerFallback
        : {}),
    }),
  });
}
