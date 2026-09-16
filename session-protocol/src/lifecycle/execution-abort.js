/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nullishText as clean } from "../normalize.js";

export const EXECUTION_ABORT_TYPE = Object.freeze({
  USER_STOP: "user_stop",
  RUN_TIMEOUT: "run_timeout",
  SOCKET_CLOSE: "socket_close",
  SYSTEM_ABORT: "system_abort",
});

const EXECUTION_ABORT_TYPES = new Set(Object.values(EXECUTION_ABORT_TYPE));

const EXECUTION_ABORTED = "execution_aborted";

function structuredAbortReason(value) {
  if (!value || typeof value !== "object") return null;
  const type = clean(value.type);
  if (!EXECUTION_ABORT_TYPES.has(type)) return null;
  return Object.freeze({
    ...value,
    type,
    reason: clean(value.reason || value.message),
  });
}

export function createExecutionAbortReason(source = {}) {
  const reason = structuredAbortReason(source);
  if (!reason) throw new TypeError("execution abort reason requires a supported type");
  return reason;
}

export function resolveExecutionAbortReason({ error = null, abortSignal = null } = {}) {
  const candidates = [
    abortSignal?.reason,
    error?.reason,
    error?.cause?.reason,
    error,
    error?.cause,
  ];
  for (const candidate of candidates) {
    const reason = structuredAbortReason(candidate);
    if (reason) return reason;
  }
  return null;
}

export function isExecutionAbortError({ error = null, abortSignal = null } = {}) {
  if (abortSignal?.aborted || resolveExecutionAbortReason({ error, abortSignal })) return true;
  if (clean(error?.name).toLowerCase() === "aborterror") return true;
  if (clean(error?.code).toUpperCase() === "ABORT_ERR") return true;
  const cause = error?.cause;
  if (!cause || cause === error) return false;
  return isExecutionAbortError({ error: cause });
}

export function resolveExecutionAbortType({ error = null, abortSignal = null } = {}) {
  const reason = resolveExecutionAbortReason({ error, abortSignal });
  if (reason?.type) return reason.type;
  return isExecutionAbortError({ error, abortSignal }) ? "interrupted" : "";
}

export function resolveExecutionAbortMessage({
  error = null,
  abortSignal = null,
  fallback = "",
} = {}) {
  const reason = resolveExecutionAbortReason({ error, abortSignal });
  if (reason) return clean(reason.reason) || reason.type;
  return clean(error?.message) || clean(fallback);
}

export function isExecutionUserStop({ error = null, abortSignal = null } = {}) {
  return resolveExecutionAbortType({ error, abortSignal }) === EXECUTION_ABORT_TYPE.USER_STOP;
}

export function createExecutionAbortError({ abortSignal = null } = {}) {
  const reason = resolveExecutionAbortReason({ abortSignal });
  const error = new Error(clean(reason?.reason) || clean(reason?.type) || EXECUTION_ABORTED);
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  if (reason) error.reason = reason;
  return error;
}

export function assertExecutionNotAborted({ abortSignal = null } = {}) {
  if (!abortSignal?.aborted) return;
  throw createExecutionAbortError({ abortSignal });
}

export function raceExecutionAbort(promise, { abortSignal = null } = {}) {
  if (!abortSignal || typeof abortSignal.addEventListener !== "function") return promise;
  if (abortSignal.aborted) {
    return Promise.reject(createExecutionAbortError({ abortSignal }));
  }
  let onAbort = null;
  const abortPromise = new Promise((_, reject) => {
    onAbort = () => reject(createExecutionAbortError({ abortSignal }));
    abortSignal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([promise, abortPromise]).finally(() => {
    if (onAbort) abortSignal.removeEventListener?.("abort", onAbort);
  });
}
