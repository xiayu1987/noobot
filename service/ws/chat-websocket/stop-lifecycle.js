/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeRunIdentityPart } from "./run-registry.js";

export function buildStoppedPartialAssistant({ stopPayload = {}, runMeta = {}, result = {}, fallbackMessage = "" } = {}) {
  const sourcePartial = stopPayload?.partialAssistant && typeof stopPayload.partialAssistant === "object"
    ? stopPayload.partialAssistant
    : {};
  const dialogProcessId =
    normalizeRunIdentityPart(sourcePartial.dialogProcessId) ||
    normalizeRunIdentityPart(stopPayload?.dialogProcessId) ||
    normalizeRunIdentityPart(runMeta?.dialogProcessId) ||
    normalizeRunIdentityPart(result?.dialogProcessId);
  const turnScopeId =
    normalizeRunIdentityPart(sourcePartial.turnScopeId) ||
    normalizeRunIdentityPart(stopPayload?.turnScopeId) ||
    normalizeRunIdentityPart(runMeta?.turnScopeId);
  const sessionId =
    normalizeRunIdentityPart(sourcePartial.sessionId) ||
    normalizeRunIdentityPart(stopPayload?.sessionId) ||
    normalizeRunIdentityPart(runMeta?.sessionId) ||
    normalizeRunIdentityPart(result?.sessionId);
  const content = String(sourcePartial.content ?? stopPayload?.message ?? fallbackMessage ?? "").trim();
  return {
    ...sourcePartial,
    content,
    sessionId,
    dialogProcessId,
    turnScopeId,
  };
}

export function isAbortLikeError(error) {
  const normalizedName = String(error?.name || "").trim().toLowerCase();
  const message = String(error?.message || "").trim().toLowerCase();
  const code = String(error?.code || "").trim().toUpperCase();
  return (
    normalizedName === "aborterror" ||
    code === "ABORT_ERR" ||
    message === "aborterror" ||
    message.includes("aborterror") ||
    message.includes("aborted") ||
    message.includes("stopped by user")
  );
}

export function isUserStopAbortReason(reason = {}) {
  return reason && typeof reason === "object" && String(reason?.type || "").trim() === "user_stop";
}

export function isUserStopRunAbort({ stopRequested = false, abortSignal = null } = {}) {
  return stopRequested === true || isUserStopAbortReason(abortSignal?.reason);
}

export function isSocketCloseRunAbort(abortSignal = null) {
  const reason = abortSignal?.reason;
  return reason && typeof reason === "object" && String(reason?.type || "").trim() === "socket_close";
}

export function buildAbortErrorMessage({ error = null, abortSignal = null, currentLocale = "", translateText = (key) => key } = {}) {
  const reason = abortSignal?.reason;
  const reasonType = reason && typeof reason === "object" ? String(reason?.type || "").trim() : "";
  const reasonText = reason && typeof reason === "object" ? String(reason?.reason || "").trim() : "";
  return (
    String(error?.message || "").trim() ||
    reasonText ||
    (reasonType ? `run aborted: ${reasonType}` : "") ||
    translateText("ws.unknownError", currentLocale)
  );
}
