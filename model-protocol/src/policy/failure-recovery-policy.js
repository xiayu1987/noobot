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

export const MODEL_REQUEST_REVISION = Object.freeze({
  SET_STREAMING_MODE: "set_streaming_mode",
});

const REVISIONS = new Map([[K.RESPONSE_MODE_MISMATCH, MODEL_REQUEST_REVISION.SET_STREAMING_MODE]]);

const RETRY_SAME_KINDS = new Set([K.RATE_LIMIT, K.TIMEOUT, K.TEMPORARY_UNAVAILABLE, K.UNKNOWN]);

export function resolveModelFailureRecovery({ kind }) {
  const revision = REVISIONS.get(kind) ?? null;
  let action = MODEL_RECOVERY_ACTION.STOP;
  if (revision) action = MODEL_RECOVERY_ACTION.REVISE_REQUEST;
  else if (RETRY_SAME_KINDS.has(kind)) action = MODEL_RECOVERY_ACTION.RETRY_SAME;
  return Object.freeze({ action, revision });
}

export function resolveUntriedStreamingMode({ modes, triedModes }) {
  return modes.find((mode) => !triedModes.has(mode)) ?? null;
}

export function mayReplayModelRequest({ outputObserved, attempts, maxAttempts, signal }) {
  return !signal?.aborted && !outputObserved && attempts < maxAttempts;
}

export function resolveModelRetryDelay({ attempt, baseDelayMs, retryAfterMs = 0 }) {
  const maxDelayMs = TIME_THRESHOLDS.model.maxRetryDelayMs;
  if (!Number.isFinite(retryAfterMs) || retryAfterMs > maxDelayMs)
    throw new ModelProtocolError("provider retry wait exceeds the allowed budget", {
      details: { retryAfterMs, maxDelayMs },
    });
  return Math.max(retryAfterMs, Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)));
}
