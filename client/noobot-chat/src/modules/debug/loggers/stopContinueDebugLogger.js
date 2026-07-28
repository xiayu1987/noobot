/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

let sessionLogSink = null;

export function setStopContinueDebugLogSink(sink = null) {
  sessionLogSink = sink && typeof sink.log === "function" ? sink : null;
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
  try {
    sessionLogSink?.log?.({
      category: "debug",
      level: "debug",
      debugType: "stop-continue",
      event,
      sessionId: payload?.sessionId || payload?.runState?.sessionId || "",
      dialogProcessId: payload?.dialogProcessId || payload?.runState?.dialogProcessId || "",
      turnScopeId: payload?.turnScopeId || payload?.runState?.turnScopeId || "",
      data: {
        event,
        at: new Date().toISOString(),
        ...payload,
      },
    });
  } catch {}
}

export function logContinueResumeIdentitySelection({ runState = {}, selected = {}, options = {} } = {}) {
  const currentDialog = String(runState?.dialogProcessId || "");
  const currentTurn = String(runState?.turnScopeId || "");
  const resumeDialogProcessId = String(selected?.resumeDialogProcessId || "");
  const resumeTurnScopeId = String(selected?.resumeTurnScopeId || "");
  const explicitSource = String(options?.resumeIdentitySource || "");
  logStopContinueDebug("frontend.stopContinue.continueResumeIdentitySelected", {
    sessionId: runState?.sessionId || "",
    dialogProcessId: currentDialog,
    turnScopeId: currentTurn,
    runState: summarizeStopContinueRunState(runState),
    resumeDialogProcessId,
    resumeTurnScopeId,
    resumeIdentitySource: explicitSource || (resumeDialogProcessId && resumeTurnScopeId ? "turn_status" : "missing_turn_status_identity"),
    hasOptionResumeIdentity: Boolean(options?.resumeDialogProcessId || options?.resumeTurnScopeId),
  });
}

export function logStopButtonEvaluation({ previousState = {}, nextState = {}, event = {}, evaluation = {}, changed = false } = {}) {
  logStopContinueDebug("frontend.stopContinue.stopButtonEvaluated", {
    sessionId: nextState?.sessionId || previousState?.sessionId || event?.sessionId || "",
    dialogProcessId: nextState?.dialogProcessId || event?.dialogProcessId || "",
    turnScopeId: nextState?.turnScopeId || event?.turnScopeId || "",
    previousState: summarizeStopContinueRunState(previousState),
    nextState: summarizeStopContinueRunState(nextState),
    eventType: event?.type || "",
    eventState: event?.state || "",
    canStop: Boolean(evaluation?.canStop),
    backendCanStop: Boolean(evaluation?.backendCanStop),
    sending: Boolean(evaluation?.sending),
    stopInFlight: Boolean(evaluation?.stopInFlight),
    stopButtonHiddenReason: evaluation?.canStop ? "" : "backend_not_stoppable_and_no_pending_request",
    changed: Boolean(changed),
  });
}
