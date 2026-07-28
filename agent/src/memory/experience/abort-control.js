/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function isAbortLikeError(error = {}) {
  const name = String(error?.name || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return name.includes("abort") || message.includes("abort");
}

export function throwIfAborted(abortSignal = null) {
  if (!abortSignal?.aborted) return;
  const abortError = new Error("memory summarize aborted");
  abortError.name = "AbortError";
  throw abortError;
}

