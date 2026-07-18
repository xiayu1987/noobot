/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BackendChannelState, FrontendRunState, SESSION_RUN_EVENT } from "./constants";
import { normalizeSessionRunEvent } from "./eventNormalization";
import { deriveTurnCapabilities, isFinalTurnState, reduceTurnRuntimeEvent } from "./turnReducer";

function text(value) {
  return String(value || "").trim();
}

export function sessionRuntimeId(value = {}) {
  return text(value?.backendSessionId || value?.sessionId || value?.id || value);
}

export function createTurnRuntimeRegistryState() {
  return { turns: {}, activeTurnBySession: {}, turnByDialogProcess: {} };
}

export function turnRuntimeDisplayState(turn = null) {
  if (!turn) return "send";
  if (turn.terminal === "user_stopped") return "continue";
  if (turn.terminal) return "send";
  const state = text(turn.state).toLowerCase();
  if ([FrontendRunState.ACTION_REQUESTING, FrontendRunState.CONTINUE_REQUESTING].includes(state)) return "requesting";
  if (state === FrontendRunState.FRONTEND_COMPLETION_REQUESTING) return "completing";
  if (state === FrontendRunState.USER_STOPPING) return "stopping";
  if ([FrontendRunState.PROCESSING, BackendChannelState.SENDING, BackendChannelState.RECONNECTING, BackendChannelState.INTERACTION_PENDING].includes(state)) return "sending";
  return "send";
}

export function resolveSessionTurnRuntime(registry, sessionId) {
  const normalizedSessionId = text(sessionId);
  const turnScopeId = text(registry?.activeTurnBySession?.[normalizedSessionId]);
  return turnScopeId ? registry?.turns?.[turnScopeId] || null : null;
}

// Public read model for session-scoped UI. Components must consume this
// projection instead of keeping application-wide `sending`/`canStop` flags.
export function selectSessionTurnRuntime(registry, sessionId) {
  const normalizedSessionId = text(sessionId);
  const turn = resolveSessionTurnRuntime(registry, normalizedSessionId);
  const displayState = turnRuntimeDisplayState(turn);
  return {
    sessionId: normalizedSessionId,
    turnScopeId: text(turn?.turnScopeId),
    dialogProcessId: text(turn?.dialogProcessId),
    displayState,
    sending: ["requesting", "sending", "completing", "stopping"].includes(displayState),
    canStop: displayState === "sending" && turn?.canStop === true,
    terminal: turn?.terminal || null,
  };
}

// Message runtime effects are scoped to one concrete turn. This read model is
// intentionally identity-complete so callers never have to combine a global
// state snapshot with whichever session happens to be visible.
export function selectTurnMessageRuntime(registry, { sessionId = "", turnScopeId = "", dialogProcessId = "" } = {}) {
  const normalizedSessionId = text(sessionId);
  const normalizedDialogProcessId = text(dialogProcessId);
  let normalizedTurnScopeId = text(turnScopeId);
  if (!normalizedTurnScopeId && normalizedDialogProcessId) {
    normalizedTurnScopeId = text(registry?.turnByDialogProcess?.[normalizedDialogProcessId]);
  }
  const turn = normalizedTurnScopeId ? registry?.turns?.[normalizedTurnScopeId] : null;
  if (!turn) return null;
  if (normalizedSessionId && turn.sessionId !== normalizedSessionId) return null;
  if (normalizedDialogProcessId && turn.dialogProcessId && turn.dialogProcessId !== normalizedDialogProcessId) return null;
  const state = [
    BackendChannelState.SENDING,
    BackendChannelState.RECONNECTING,
    BackendChannelState.INTERACTION_PENDING,
  ].includes(turn.state)
    ? FrontendRunState.PROCESSING
    : turn.state || "";
  return {
    state,
    backendState: turn.backendState || "",
    sessionId: turn.sessionId,
    turnScopeId: turn.turnScopeId,
    dialogProcessId: turn.dialogProcessId || "",
    source: turn.source || "",
    sourceEvent: turn.sourceEvent || "",
    seq: Number(turn.seq || 0),
    updatedAt: turn.updatedAt || "",
    updatedAtMs: Number(turn.updatedAtMs || 0),
    terminal: turn.terminal || null,
  };
}

export function resolveLatestStoppedTurn(registry, sessionId) {
  const normalizedSessionId = text(sessionId);
  return Object.values(registry?.turns || {})
    .filter((turn) => turn.sessionId === normalizedSessionId && turn.terminal === "user_stopped")
    .sort((a, b) => Number(b.updatedAtMs || 0) - Number(a.updatedAtMs || 0))[0] || null;
}

export function removeTurnRuntime(registry, turnScopeId, { sessionId = "" } = {}) {
  const scope = text(turnScopeId);
  const expectedSessionId = text(sessionId);
  const turn = scope ? registry?.turns?.[scope] : null;
  if (!turn || (expectedSessionId && turn.sessionId !== expectedSessionId)) return false;
  delete registry.turns[scope];
  if (turn.dialogProcessId && registry.turnByDialogProcess?.[turn.dialogProcessId] === scope) {
    delete registry.turnByDialogProcess[turn.dialogProcessId];
  }
  if (registry.activeTurnBySession?.[turn.sessionId] === scope) {
    delete registry.activeTurnBySession[turn.sessionId];
  }
  return true;
}

export function applyTurnRuntimeEvent(registry, rawEvent = {}) {
  const next = registry || createTurnRuntimeRegistryState();
  const event = normalizeSessionRunEvent(rawEvent);
  let turnScopeId = text(event.turnScopeId);
  if (!turnScopeId && event.dialogProcessId) turnScopeId = text(next.turnByDialogProcess[event.dialogProcessId]);
  if (!turnScopeId) return { registry: next, turn: null, applied: false, reason: "missing_turn_identity" };
  const current = next.turns[turnScopeId] || null;
  const sessionId = text(event.sessionId || current?.sessionId);
  if (!sessionId) return { registry: next, turn: current, applied: false, reason: "missing_session_identity" };
  if (current?.sessionId && current.sessionId !== sessionId) return { registry: next, turn: current, applied: false, reason: "session_identity_conflict" };
  if (current?.dialogProcessId && event.dialogProcessId && current.dialogProcessId !== event.dialogProcessId) return { registry: next, turn: current, applied: false, reason: "dialog_process_identity_conflict" };
  const dialogOwner = event.dialogProcessId ? next.turnByDialogProcess[event.dialogProcessId] : "";
  if (dialogOwner && dialogOwner !== turnScopeId) {
    return { registry: next, turn: current, applied: false, reason: "dialog_process_identity_conflict" };
  }
  const activeTurn = resolveSessionTurnRuntime(next, sessionId);
  if (!current && activeTurn && !isFinalTurnState(activeTurn.state)) {
    return { registry: next, turn: activeTurn, applied: false, reason: "active_turn_conflict" };
  }
  const transition = reduceTurnRuntimeEvent(current, rawEvent);
  if (!transition.applied) {
    return { registry: next, turn: current, applied: false, reason: transition.reason };
  }
  const turn = {
    ...(current || {}),
    ...transition.next,
    sessionId,
    turnScopeId,
    dialogProcessId: text(event.dialogProcessId || current?.dialogProcessId),
    action: transition.next.action,
    backendState: text(event.backendState || current?.backendState),
    state: transition.next.state,
    terminal: transition.next.terminal,
    canStop: deriveTurnCapabilities(transition.next.state, {
      backendState: transition.next.backendState,
    }).canStop,
    seq: transition.next.seq,
    updatedAtMs: Number(event.timestamp || Date.now()),
    updatedAt: text(event.updatedAt || current?.updatedAt),
    source: text(event.source || current?.source),
    sourceEvent: text(event.sourceEvent || event.type || current?.sourceEvent),
    error: transition.next.terminal === "error" ? text(rawEvent?.error?.message || rawEvent?.error || rawEvent?.reason) : null,
  };
  next.turns[turnScopeId] = turn;
  next.activeTurnBySession[sessionId] = turnScopeId;
  if (turn.dialogProcessId) next.turnByDialogProcess[turn.dialogProcessId] = turnScopeId;
  return { registry: next, turn, applied: true, reason: transition.reason };
}

export function hydrateSessionTurnRuntime(registry, session, turnStatuses = session?.turnStatuses || []) {
  const sessionId = sessionRuntimeId(session);
  if (!sessionId) return registry;
  for (const status of Array.isArray(turnStatuses) ? turnStatuses : []) {
    const turnScopeId = text(status?.turnScopeId);
    if (!turnScopeId) continue;
    const scope = {
      sessionId,
      turnScopeId,
      dialogProcessId: status?.dialogProcessId,
      updatedAt: status?.updatedAt,
      authoritativeSnapshot: true,
      source: "session_summary_replay",
    };
    const terminalStatus = text(status?.status).toLowerCase();
    // A summary replay reconstructs the same domain phases without repeating
    // network side effects. The summary-applied event is the only event allowed
    // to expose a frontend terminal.
    applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED, ...scope, dialogProcessId: "", seq: 0 });
    applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, ...scope, state: BackendChannelState.SENDING, seq: 0 });
    if (terminalStatus === BackendChannelState.USER_STOPPED) {
      applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUESTED, ...scope, seq: 0 });
      applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, ...scope, state: BackendChannelState.USER_STOPPED, seq: 0 });
      applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_APPLIED, ...scope, seq: Number(status?.seq || 0) });
    } else if (terminalStatus === BackendChannelState.COMPLETED) {
      applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, ...scope, state: BackendChannelState.COMPLETED, seq: 0 });
      applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED, ...scope, seq: Number(status?.seq || 0) });
    } else {
      applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, ...scope, state: terminalStatus, seq: Number(status?.seq || 0) });
    }
  }
  return registry;
}
