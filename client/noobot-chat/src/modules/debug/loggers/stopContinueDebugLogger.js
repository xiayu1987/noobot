/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { acceptsDebugSink, emitLazyDebugSafely, isDebugTypeEnabled } from "./lazyDebugSink.js";

let sessionLogSink = null;

export function setStopContinueDebugLogSink(sink = null) {
  sessionLogSink = acceptsDebugSink(sink) ? sink : null;
}

function pickComposerActionState(value = {}) {
  return {
    sendRequesting: Boolean(value?.sendRequesting),
    continueRequesting: Boolean(value?.continueRequesting),
    stopRequesting: Boolean(value?.stopRequesting),
    stopPendingUntilBackendReady: Boolean(value?.stopPendingUntilBackendReady),
  };
}

export function summarizeStopContinueRunState(state = {}) {
  return {
    state: String(state?.state || ""),
    sessionId: String(state?.sessionId || ""),
    dialogProcessId: String(state?.dialogProcessId || ""),
    turnScopeId: String(state?.turnScopeId || ""),
    seq: Number(state?.seq || 0),
    composerActionState: pickComposerActionState(state?.composerActionState),
  };
}

export function logStopContinueDebug(event, payload = {}) {
  return emitLazyDebugSafely(sessionLogSink, "stop-continue", event, payload);
}

export function logContinueResumeIdentitySelection({
  runState = {},
  selected = {},
  options = {},
} = {}) {
  if (!isDebugTypeEnabled(sessionLogSink, "stop-continue")) return false;
  const currentDialog = String(runState?.dialogProcessId || "");
  const currentTurn = String(runState?.turnScopeId || "");
  const resumeDialogProcessId = String(selected?.resumeDialogProcessId || "");
  const resumeTurnScopeId = String(selected?.resumeTurnScopeId || "");
  const explicitSource = String(options?.resumeIdentitySource || "");
  logStopContinueDebug("frontend.stopContinue.continueResumeIdentitySelected", () => ({
    sessionId: runState?.sessionId || "",
    dialogProcessId: currentDialog,
    turnScopeId: currentTurn,
    runState: summarizeStopContinueRunState(runState),
    resumeDialogProcessId,
    resumeTurnScopeId,
    resumeIdentitySource:
      explicitSource ||
      (resumeDialogProcessId && resumeTurnScopeId ? "turn_status" : "missing_turn_status_identity"),
    hasOptionResumeIdentity: Boolean(options?.resumeDialogProcessId || options?.resumeTurnScopeId),
  }));
}
