/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_RUN_STATE } from "./constants";
import { toIsoTime } from "../../infra/timeFields";
import { transitionPriority } from "./normalize";

export function createInitialSessionRunState(overrides = {}) {
  return {
    state: SESSION_RUN_STATE.IDLE,
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
    lastEventType: "",
    ...overrides,
  };
}

export function applySessionRunEventPatch({ current, event, startsNewTurn, nextDialogProcessId, nextTurnScopeId }) {
  return {
    state: event.state,
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
      event.state === SESSION_RUN_STATE.STOP_REQUESTED
        ? event.timestamp
        : startsNewTurn
          ? 0
        : Number(current.stopRequestedAt || 0),
    lastEventType: event.type,
  };
}
