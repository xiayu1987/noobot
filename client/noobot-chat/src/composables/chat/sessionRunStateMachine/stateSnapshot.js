/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { FrontendRunState, SESSION_RUN_EVENT } from "./constants";
import { toIsoTime } from "../../infra/timeFields";
import { transitionPriority } from "./normalize";

export function createInitialSessionRunState(overrides = {}) {
  return {
    state: FrontendRunState.IDLE,
    backendState: "",
    sessionId: "",
    dialogProcessId: "",
    turnScopeId: "",
    source: "initial",
    sourceEvent: "",
    seq: 0,
    priority: 0,
    createdAtMs: 0,
    updatedAtMs: 0,
    createdAtIso: "",
    updatedAtIso: "",
    updatedAt: 0,
    stopRequestedAt: 0,
    composerActionState: {
      sendRequesting: false,
      continueRequesting: false,
      stopRequesting: false,
      stopPendingUntilBackendReady: false,
    },
    lastEventType: "",
    ...overrides,
  };
}

export function applySessionRunActionEventPatch({ current, event }) {
  const currentComposerActionState = current?.composerActionState || {};
  const nextComposerActionState = {
    sendRequesting: Boolean(currentComposerActionState.sendRequesting),
    continueRequesting: Boolean(currentComposerActionState.continueRequesting),
    stopRequesting: Boolean(currentComposerActionState.stopRequesting),
    stopPendingUntilBackendReady: Boolean(currentComposerActionState.stopPendingUntilBackendReady),
  };
  if (event.type === "local_send_request_started") nextComposerActionState.sendRequesting = true;
  if (event.type === "local_send_request_settled") nextComposerActionState.sendRequesting = false;
  if (event.type === "local_continue_request_started") nextComposerActionState.continueRequesting = true;
  if (event.type === "local_continue_request_settled") nextComposerActionState.continueRequesting = false;
  if (event.type === SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED) nextComposerActionState.stopRequesting = true;
  if (event.type === SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_SETTLED) nextComposerActionState.stopRequesting = false;
  if (event.type === SESSION_RUN_EVENT.LOCAL_USER_STOP_PENDING_BACKEND_READY) {
    nextComposerActionState.stopRequesting = true;
    nextComposerActionState.stopPendingUntilBackendReady = true;
  }
  if (event.type === SESSION_RUN_EVENT.LOCAL_USER_STOP_PENDING_CLEARED) {
    nextComposerActionState.stopPendingUntilBackendReady = false;
  }
  return {
    ...current,
    composerActionState: nextComposerActionState,
    updatedAt: event.timestamp,
    updatedAtMs: event.updatedAtMs || event.timestamp,
    updatedAtIso:
      event.updatedAt ||
      (event.updatedAtMs > 0 ? toIsoTime(event.updatedAtMs) : toIsoTime(event.timestamp)),
    lastEventType: event.type,
  };
}

export function applySessionRunEventPatch({ current, event, startsNewTurn, nextDialogProcessId, nextTurnScopeId }) {
  return {
    state: event.state,
    backendState: event.backendState || "",
    sessionId: event.sessionId || current.sessionId,
    dialogProcessId: nextDialogProcessId,
    turnScopeId: nextTurnScopeId,
    source: event.source,
    sourceEvent: event.sourceEvent,
    seq: Math.max(Number(current.seq || 0), Number(event.seq || 0)),
    priority: transitionPriority(event.state),
    createdAtMs:
      event.createdAtMs ||
      (startsNewTurn ? event.timestamp : Number(current.createdAtMs || 0)),
    updatedAtMs: event.updatedAtMs || event.timestamp,
    createdAtIso:
      event.createdAt ||
      (event.createdAtMs > 0
        ? toIsoTime(event.createdAtMs)
        : startsNewTurn
          ? toIsoTime(event.timestamp)
          : current.createdAtIso),
    updatedAtIso:
      event.updatedAt ||
      (event.updatedAtMs > 0
        ? toIsoTime(event.updatedAtMs)
        : toIsoTime(event.timestamp)),
    updatedAt: event.timestamp,
    stopRequestedAt:
      event.state === FrontendRunState.USER_STOP_REQUESTED
        ? event.timestamp
        : startsNewTurn
          ? 0
        : Number(current.stopRequestedAt || 0),
    composerActionState: {
      sendRequesting: false,
      continueRequesting: false,
      stopRequesting:
        event.state === FrontendRunState.USER_STOP_REQUESTED
          ? Boolean(current?.composerActionState?.stopRequesting)
          : false,
      stopPendingUntilBackendReady: false,
    },
    lastEventType: event.type,
  };
}
