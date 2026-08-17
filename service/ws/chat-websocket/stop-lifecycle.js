/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeRunIdentityPart } from "./run-registry.js";
import {
  EXECUTION_ABORT_TYPE,
  isExecutionAbortError,
  resolveExecutionAbortMessage,
  resolveExecutionAbortType,
} from "@noobot/session-protocol/execution-abort";

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
  return isExecutionAbortError({ error });
}

export function isUserStopAbortReason(reason = {}) {
  return (
    resolveExecutionAbortType({ abortSignal: { aborted: true, reason } }) ===
    EXECUTION_ABORT_TYPE.USER_STOP
  );
}

export function isUserStopRunAbort({ stopRequested = false, abortSignal = null } = {}) {
  return stopRequested === true || isUserStopAbortReason(abortSignal?.reason);
}

export function isSocketCloseRunAbort(abortSignal = null) {
  return resolveExecutionAbortType({ abortSignal }) === EXECUTION_ABORT_TYPE.SOCKET_CLOSE;
}

export function buildAbortErrorMessage({ error = null, abortSignal = null, currentLocale = "", translateText = (key) => key } = {}) {
  const reasonType = resolveExecutionAbortType({ error, abortSignal });
  return resolveExecutionAbortMessage({
    error,
    abortSignal,
    fallback: reasonType
      ? `run aborted: ${reasonType}`
      : translateText("ws.unknownError", currentLocale),
  });
}
