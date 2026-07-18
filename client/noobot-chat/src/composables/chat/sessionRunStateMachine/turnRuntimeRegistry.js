/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BackendChannelState, FrontendRunState, SESSION_RUN_EVENT } from "./constants";
import { normalizeSessionRunEvent } from "./eventNormalization";
import { deriveTurnCapabilities, isFinalTurnState, reduceTurnRuntimeEvent } from "./turnReducer";

export const DEFAULT_TERMINAL_RETAIN_PER_SESSION = 10;
export const DEFAULT_TERMINAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function text(value) {
  return String(value || "").trim();
}

export function sessionRuntimeId(value = {}) {
  return text(value?.backendSessionId || value?.sessionId || value?.id || value);
}

export function createTurnRuntimeRegistryState() {
  return { sessions: {}, routeIndex: {} };
}

function ensureSessionBucket(registry, sessionId) {
  const id = text(sessionId);
  if (!registry.sessions) registry.sessions = {};
  if (!registry.routeIndex) registry.routeIndex = {};
  if (!registry.sessions[id]) registry.sessions[id] = { activeTurnScopeId: "", turns: {} };
  return registry.sessions[id];
}

function findTurnByScope(registry, turnScopeId) {
  const scope = text(turnScopeId);
  if (!scope) return null;
  for (const bucket of Object.values(registry?.sessions || {})) {
    const turn = bucket?.turns?.[scope];
    if (turn) return turn;
  }
  return null;
}

function resolveRoute(registry, dialogProcessId) {
  const id = text(dialogProcessId);
  return id ? registry?.routeIndex?.[id] || null : null;
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
  const bucket = registry?.sessions?.[text(sessionId)];
  const scope = text(bucket?.activeTurnScopeId);
  return scope ? bucket?.turns?.[scope] || null : null;
}

export function resolveTurnRuntimeByScope(registry, turnScopeId, { sessionId = "" } = {}) {
  const scope = text(turnScopeId);
  const id = text(sessionId);
  if (!scope) return null;
  return id ? registry?.sessions?.[id]?.turns?.[scope] || null : findTurnByScope(registry, scope);
}

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

export function selectTurnMessageRuntime(registry, { sessionId = "", turnScopeId = "", dialogProcessId = "" } = {}) {
  const normalizedSessionId = text(sessionId);
  const normalizedDialogProcessId = text(dialogProcessId);
  let normalizedTurnScopeId = text(turnScopeId);
  let routeSessionId = "";
  if (!normalizedTurnScopeId && normalizedDialogProcessId) {
    const route = resolveRoute(registry, normalizedDialogProcessId);
    normalizedTurnScopeId = text(route?.turnScopeId);
    routeSessionId = text(route?.sessionId);
  }
  const turn = normalizedTurnScopeId
    ? resolveTurnRuntimeByScope(registry, normalizedTurnScopeId, { sessionId: normalizedSessionId || routeSessionId })
    : null;
  if (!turn) return null;
  if (normalizedSessionId && turn.sessionId !== normalizedSessionId) return null;
  if (normalizedDialogProcessId && turn.dialogProcessId && turn.dialogProcessId !== normalizedDialogProcessId) return null;
  const state = [BackendChannelState.SENDING, BackendChannelState.RECONNECTING, BackendChannelState.INTERACTION_PENDING].includes(turn.state)
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
  const bucket = registry?.sessions?.[text(sessionId)];
  return Object.values(bucket?.turns || {})
    .filter((turn) => turn.terminal === "user_stopped")
    .sort((a, b) => Number(b.finishedAtMs || b.updatedAtMs || 0) - Number(a.finishedAtMs || a.updatedAtMs || 0))[0] || null;
}

export function removeTurnRuntime(registry, turnScopeId, { sessionId = "" } = {}) {
  const scope = text(turnScopeId);
  const expectedSessionId = text(sessionId);
  const turn = resolveTurnRuntimeByScope(registry, scope, { sessionId: expectedSessionId });
  if (!turn || (expectedSessionId && turn.sessionId !== expectedSessionId)) return false;
  const bucket = registry?.sessions?.[turn.sessionId];
  if (!bucket) return false;
  delete bucket.turns[scope];
  if (turn.dialogProcessId && registry.routeIndex?.[turn.dialogProcessId]?.turnScopeId === scope) {
    delete registry.routeIndex[turn.dialogProcessId];
  }
  if (bucket.activeTurnScopeId === scope) bucket.activeTurnScopeId = "";
  if (!Object.keys(bucket.turns).length) delete registry.sessions[turn.sessionId];
  return true;
}

export function removeSessionRuntime(registry, sessionId) {
  const id = text(sessionId);
  const bucket = registry?.sessions?.[id];
  if (!bucket) return false;
  for (const turn of Object.values(bucket.turns || {})) {
    const route = registry.routeIndex?.[text(turn?.dialogProcessId)];
    if (route?.sessionId === id && route?.turnScopeId === turn.turnScopeId) delete registry.routeIndex[turn.dialogProcessId];
  }
  delete registry.sessions[id];
  return true;
}

export function pruneTerminalTurns(registry, {
  sessionId,
  referencedTurnScopeIds = [],
  retainCount = DEFAULT_TERMINAL_RETAIN_PER_SESSION,
  maxAgeMs = DEFAULT_TERMINAL_MAX_AGE_MS,
  nowMs = Date.now(),
} = {}) {
  const id = text(sessionId);
  const bucket = registry?.sessions?.[id];
  if (!bucket) return { removedTurnScopeIds: [] };
  const referenced = new Set(Array.from(referencedTurnScopeIds || [], text).filter(Boolean));
  const activeScope = text(bucket.activeTurnScopeId);
  const latestStoppedScope = text(resolveLatestStoppedTurn(registry, id)?.turnScopeId);
  const terminalTurns = Object.values(bucket.turns || {})
    .filter((turn) => Boolean(turn.terminal))
    .sort((a, b) => Number(b.finishedAtMs || b.updatedAtMs || 0) - Number(a.finishedAtMs || a.updatedAtMs || 0));
  const removedTurnScopeIds = [];
  let retainedUnprotectedCount = 0;
  for (const turn of terminalTurns) {
    const scope = text(turn.turnScopeId);
    if (scope === activeScope || scope === latestStoppedScope || referenced.has(scope)) continue;
    const finishedAtMs = Number(turn.finishedAtMs || turn.updatedAtMs || 0);
    const tooOld = maxAgeMs >= 0 && finishedAtMs > 0 && Number(nowMs) - finishedAtMs > maxAgeMs;
    const overCount = retainCount >= 0 && retainedUnprotectedCount >= retainCount;
    if (tooOld || overCount) {
      if (removeTurnRuntime(registry, scope, { sessionId: id })) removedTurnScopeIds.push(scope);
    } else {
      retainedUnprotectedCount += 1;
    }
  }
  return { removedTurnScopeIds };
}

export function applyTurnRuntimeEvent(registry, rawEvent = {}) {
  const next = registry || createTurnRuntimeRegistryState();
  if (!next.sessions) next.sessions = {};
  if (!next.routeIndex) next.routeIndex = {};
  const event = normalizeSessionRunEvent(rawEvent);
  let turnScopeId = text(event.turnScopeId);
  const route = resolveRoute(next, event.dialogProcessId);
  if (!turnScopeId && route) turnScopeId = text(route.turnScopeId);
  if (!turnScopeId) return { registry: next, turn: null, applied: false, reason: "missing_turn_identity" };
  const current = findTurnByScope(next, turnScopeId);
  const sessionId = text(event.sessionId || current?.sessionId || route?.sessionId);
  if (!sessionId) return { registry: next, turn: current, applied: false, reason: "missing_session_identity" };
  if (current?.sessionId && current.sessionId !== sessionId) return { registry: next, turn: current, applied: false, reason: "session_identity_conflict" };
  if (current?.dialogProcessId && event.dialogProcessId && current.dialogProcessId !== event.dialogProcessId) return { registry: next, turn: current, applied: false, reason: "dialog_process_identity_conflict" };
  if (route && (route.turnScopeId !== turnScopeId || route.sessionId !== sessionId)) {
    return { registry: next, turn: current, applied: false, reason: "dialog_process_identity_conflict" };
  }
  const activeTurn = resolveSessionTurnRuntime(next, sessionId);
  if (!current && activeTurn && !isFinalTurnState(activeTurn.state)) {
    return { registry: next, turn: activeTurn, applied: false, reason: "active_turn_conflict" };
  }
  const transition = reduceTurnRuntimeEvent(current, rawEvent);
  if (!transition.applied) return { registry: next, turn: current, applied: false, reason: transition.reason };
  const nowMs = Number(event.timestamp || Date.now());
  const terminal = transition.next.terminal;
  const turn = {
    ...(current || {}),
    ...transition.next,
    sessionId,
    turnScopeId,
    dialogProcessId: text(event.dialogProcessId || current?.dialogProcessId),
    action: transition.next.action,
    backendState: text(event.backendState || current?.backendState),
    state: transition.next.state,
    terminal,
    canStop: deriveTurnCapabilities(transition.next.state, { backendState: transition.next.backendState }).canStop,
    seq: transition.next.seq,
    updatedAtMs: nowMs,
    updatedAt: text(event.updatedAt || current?.updatedAt),
    source: text(event.source || current?.source),
    sourceEvent: text(event.sourceEvent || event.type || current?.sourceEvent),
    finishedAtMs: terminal ? Number(current?.finishedAtMs || nowMs) : 0,
    error: terminal === "error" ? text(rawEvent?.error?.message || rawEvent?.error || rawEvent?.reason) : null,
  };
  const bucket = ensureSessionBucket(next, sessionId);
  bucket.turns[turnScopeId] = turn;
  bucket.activeTurnScopeId = turnScopeId;
  if (turn.dialogProcessId) next.routeIndex[turn.dialogProcessId] = { sessionId, turnScopeId };
  return { registry: next, turn, applied: true, reason: transition.reason };
}

export function hydrateSessionTurnRuntime(registry, session, turnStatuses = session?.turnStatuses || []) {
  const sessionId = sessionRuntimeId(session);
  if (!sessionId) return registry;
  for (const status of Array.isArray(turnStatuses) ? turnStatuses : []) {
    const turnScopeId = text(status?.turnScopeId);
    if (!turnScopeId) continue;
    const scope = { sessionId, turnScopeId, dialogProcessId: status?.dialogProcessId, updatedAt: status?.updatedAt, authoritativeSnapshot: true, source: "session_summary_replay" };
    const terminalStatus = text(status?.status).toLowerCase();
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
