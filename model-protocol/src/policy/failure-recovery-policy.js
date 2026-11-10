/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MODEL_ERROR_KIND as K } from "../protocol/constants.js";
import { ModelProtocolError } from "../protocol/error.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

export const MODEL_RECOVERY_ACTION = Object.freeze({
  STOP: "stop",
  RETRY_SAME: "retry_same",
  REVISE_REQUEST: "revise_request",
});

const REVISIONS = new Map([
  [K.RESPONSE_MODE_MISMATCH, "set_streaming_mode"],
  [K.UNKNOWN, "set_streaming_mode"],
]);

export function resolveModelFailureRecovery(classification) {
  const revision = REVISIONS.get(classification.kind);
  let action = MODEL_RECOVERY_ACTION.STOP;
  if (revision) action = MODEL_RECOVERY_ACTION.REVISE_REQUEST;
  else if (classification.retryable) action = MODEL_RECOVERY_ACTION.RETRY_SAME;
  return Object.freeze({
    action,
    revision: revision || null,
  });
}

export function mayReplayModelRequest({ streamedTokens, attempts, maxAttempts, signal }) {
  return !signal?.aborted && streamedTokens === 0 && attempts < maxAttempts;
}

export function resolveModelRetryDelay({ attempt, baseDelayMs, retryAfterMs = 0 }) {
  const maxDelayMs = TIME_THRESHOLDS.model.maxRetryDelayMs;
  if (!Number.isFinite(retryAfterMs) || retryAfterMs > maxDelayMs)
    throw new ModelProtocolError("provider retry wait exceeds the allowed budget", {
      details: { retryAfterMs, maxDelayMs },
    });
  return Math.max(retryAfterMs, Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)));
}
