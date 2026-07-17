/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BackendChannelState, FrontendRunState, SESSION_RUN_EVENT } from "./constants";
import { normalizeSessionRunEvent } from "./eventNormalization";

const TERMINALS = new Set(["completed", "user_stopped", "error", "expired", "failed"]);
const ERROR_STATES = new Set([
  FrontendRunState.ACTION_REQUEST_ERROR,
  FrontendRunState.PROCESSING_ERROR,
  FrontendRunState.COMPLETION_ERROR,
  FrontendRunState.STOP_ERROR,
  BackendChannelState.ERROR,
  BackendChannelState.EXPIRED,
]);
const PHASE_RANK = new Map([
  [FrontendRunState.ACTION_REQUESTING, 1],
  [FrontendRunState.CONTINUE_REQUESTING, 1],
  [FrontendRunState.PROCESSING, 2],
  [BackendChannelState.SENDING, 2],
  [BackendChannelState.RECONNECTING, 2],
  [BackendChannelState.INTERACTION_PENDING, 2],
  [FrontendRunState.FRONTEND_COMPLETION_REQUESTING, 3],
  [FrontendRunState.USER_STOPPING, 3],
]);

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

function terminalFromEvent(event) {
  const backend = text(event.backendState || event.raw?.status || event.raw?.terminal).toLowerCase();
  // A channel user_stopped only confirms that persistence completed. The
  // authoritative session summary must be applied before the frontend turn is
  // terminal, so refreshed and non-refreshed clients converge from one fact.
  const isChannelUserStopped = backend === "user_stopped" &&
    event.type === SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE;
  if (TERMINALS.has(backend) && !(
    isChannelUserStopped &&
    event.raw?.authoritativeSnapshot !== true &&
    !event.raw?.terminal
  )) return backend === "failed" ? "error" : backend;
  if (event.type === SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_APPLIED) return "user_stopped";
  if ([SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED, SESSION_RUN_EVENT.LOCAL_RESEND_COMPLETED].includes(event.type)) return "completed";
  if (ERROR_STATES.has(event.state) || [SESSION_RUN_EVENT.LOCAL_FAILURE, SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_FAILED, SESSION_RUN_EVENT.LOCAL_RESEND_FAILED, SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_FAILED].includes(event.type)) return "error";
  return null;
}

function runtimeStateFromEvent(event) {
  if (event.state) return event.state;
  if ([
    SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUESTED,
    SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED,
    SESSION_RUN_EVENT.LOCAL_USER_STOP_PENDING_BACKEND_READY,
  ].includes(event.type)) return FrontendRunState.USER_STOPPING;
  if ([
    SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
    SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_STARTED,
    SESSION_RUN_EVENT.LOCAL_RESEND_STARTED,
    SESSION_RUN_EVENT.LOCAL_RESEND_REPLACING_TURN,
    SESSION_RUN_EVENT.LOCAL_RESEND_STREAMING,
  ].includes(event.type)) return FrontendRunState.ACTION_REQUESTING;
  return "";
}

export function applyTurnRuntimeEvent(registry, rawEvent = {}, { fallbackSessionId = "" } = {}) {
  const next = registry || createTurnRuntimeRegistryState();
  const event = normalizeSessionRunEvent(rawEvent);
  let turnScopeId = text(event.turnScopeId);
  if (!turnScopeId && event.dialogProcessId) turnScopeId = text(next.turnByDialogProcess[event.dialogProcessId]);
  if (!turnScopeId) return { registry: next, turn: null, applied: false };
  const current = next.turns[turnScopeId] || null;
  const sessionId = text(event.sessionId || current?.sessionId || fallbackSessionId);
  if (!sessionId) return { registry: next, turn: current, applied: false };
  if (current?.sessionId && current.sessionId !== sessionId) return { registry: next, turn: current, applied: false };
  if (current?.dialogProcessId && event.dialogProcessId && current.dialogProcessId !== event.dialogProcessId) return { registry: next, turn: current, applied: false };
  const eventSeq = Number(event.seq || 0);
  if (current?.terminal) return { registry: next, turn: current, applied: false };
  if (eventSeq > 0 && Number(current?.seq || 0) > eventSeq) return { registry: next, turn: current, applied: false };
  const terminal = terminalFromEvent(event);
  const runtimeState = runtimeStateFromEvent(event);
  const currentRank = PHASE_RANK.get(current?.state) || 0;
  const incomingRank = PHASE_RANK.get(runtimeState) || 0;
  // Sequence numbers are not guaranteed on every local/reconnect event. Keep
  // the state machine monotonic even without one, so a late requesting/sending
  // event cannot move a completing or stopping turn backwards.
  if (!terminal && incomingRank > 0 && currentRank > incomingRank) {
    return { registry: next, turn: current, applied: false };
  }
  const nextRuntimeState = runtimeState || current?.state || "";
  const turn = {
    ...(current || {}),
    sessionId,
    turnScopeId,
    dialogProcessId: text(event.dialogProcessId || current?.dialogProcessId),
    action: text(event.action || current?.action || "send"),
    state: terminal ? (terminal === "user_stopped" ? FrontendRunState.USER_STOP_COMPLETED : terminal === "completed" ? FrontendRunState.FRONTEND_COMPLETED : nextRuntimeState) : nextRuntimeState,
    terminal: terminal || null,
    canStop: !terminal && [FrontendRunState.PROCESSING, BackendChannelState.SENDING].includes(nextRuntimeState),
    seq: Math.max(Number(current?.seq || 0), eventSeq),
    updatedAtMs: Number(event.timestamp || Date.now()),
    error: terminal === "error" ? text(rawEvent?.error?.message || rawEvent?.error || rawEvent?.reason) : null,
  };
  next.turns[turnScopeId] = turn;
  next.activeTurnBySession[sessionId] = turnScopeId;
  if (turn.dialogProcessId) next.turnByDialogProcess[turn.dialogProcessId] = turnScopeId;
  return { registry: next, turn, applied: true };
}

export function hydrateSessionTurnRuntime(registry, session, turnStatuses = session?.turnStatuses || []) {
  const sessionId = sessionRuntimeId(session);
  if (!sessionId) return registry;
  for (const status of Array.isArray(turnStatuses) ? turnStatuses : []) {
    const turnScopeId = text(status?.turnScopeId);
    if (!turnScopeId) continue;
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: status?.status,
      sessionId,
      turnScopeId,
      dialogProcessId: status?.dialogProcessId,
      seq: status?.seq,
      updatedAt: status?.updatedAt,
      authoritativeSnapshot: true,
      terminal: status?.status,
    });
  }
  return registry;
}
