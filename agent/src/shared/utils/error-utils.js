/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function isAbortError(error) {
  const normalizedName = String(error?.name || "").trim().toLowerCase();
  const message = String(error?.message || "").trim().toLowerCase();
  const code = String(error?.code || "").trim().toUpperCase();
  const directType = String(error?.type || error?.stopType || "").trim();
  const causeType = String(error?.cause?.type || error?.cause?.stopType || "").trim();
  return (
    directType === "user_stop" ||
    causeType === "user_stop" ||
    normalizedName === "aborterror" ||
    code === "ABORT_ERR" ||
    message === "aborterror" ||
    message.includes("aborterror") ||
    message.includes("stopped by user") ||
    message.includes("aborted")
  );
}

export function readAbortReason(error = null, abortSignal = null) {
  const signalReason = abortSignal?.reason;
  if (signalReason && typeof signalReason === "object") return signalReason;
  const errorReason = error?.reason || error?.cause?.reason;
  if (errorReason && typeof errorReason === "object") return errorReason;
  if (error && typeof error === "object") {
    const directType = String(error?.type || error?.stopType || "").trim();
    if (directType) return error;
  }
  const cause = error?.cause;
  if (cause && typeof cause === "object") {
    const causeType = String(cause?.type || cause?.stopType || "").trim();
    if (causeType) return cause;
  }
  return signalReason || errorReason || null;
}

export function isUserStopAbort(error = null, abortSignal = null) {
  const reason = readAbortReason(error, abortSignal);
  return String(reason?.type || reason?.stopType || "").trim() === "user_stop";
}

export function resolveAbortStopType(error = null, abortSignal = null) {
  if (isUserStopAbort(error, abortSignal)) return "user_stop";
  if (isAbortError(error) || isAbortError(error?.cause) || abortSignal?.aborted) {
    const reason = readAbortReason(error, abortSignal);
    return String(reason?.type || reason?.stopType || "").trim() || "interrupted";
  }
  return "";
}
