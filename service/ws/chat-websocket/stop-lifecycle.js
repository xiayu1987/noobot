/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeRunIdentityPart } from "./run-registry.js";
import {
  EXECUTION_ABORT_TYPE,
  isExecutionAbortError,
  isExecutionUserStop,
  resolveExecutionAbortMessage,
  resolveExecutionAbortType,
} from "@noobot/session-protocol/execution-abort";
import { text } from "@noobot/shared/value";

export function buildStoppedPartialAssistant({ stopPayload, runMeta, fallbackMessage }) {
  const sourcePartial = stopPayload.partialAssistant;
  return {
    ...sourcePartial,
    content: text(sourcePartial.content ?? fallbackMessage),
    sessionId: normalizeRunIdentityPart(runMeta.sessionId),
    dialogProcessId: normalizeRunIdentityPart(runMeta.dialogProcessId),
    turnScopeId: normalizeRunIdentityPart(runMeta.turnScopeId),
  };
}

export function isAbortLikeError(error) {
  return isExecutionAbortError({ error });
}

export function isUserStopRunAbort(abortSignal = null) {
  return isExecutionUserStop({ abortSignal });
}

export function isSocketCloseRunAbort(abortSignal = null) {
  return resolveExecutionAbortType({ abortSignal }) === EXECUTION_ABORT_TYPE.SOCKET_CLOSE;
}

export function buildAbortErrorMessage({
  error = null,
  abortSignal = null,
  currentLocale = "",
  translateText = (key) => key,
} = {}) {
  const reasonType = resolveExecutionAbortType({ error, abortSignal });
  return resolveExecutionAbortMessage({
    error,
    abortSignal,
    fallback: reasonType
      ? `run aborted: ${reasonType}`
      : translateText("ws.unknownError", currentLocale),
  });
}
