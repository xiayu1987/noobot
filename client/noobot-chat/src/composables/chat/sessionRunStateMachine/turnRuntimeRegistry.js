/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BackendChannelState, FrontendRunState, SESSION_RUN_EVENT } from "./constants";
import { normalizeSessionRunEvent } from "./eventNormalization";
import { deriveTurnCapabilities, isFinalTurnState, reduceTurnRuntimeEvent } from "./turnReducer";
import {
  validateTurnLifecycleEnvelope,
  validateTurnLifecycleSnapshot,
} from "@noobot/shared/turn-lifecycle-protocol";
import { validateExecutionIdentity } from "@noobot/shared/execution-lifecycle-protocol";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { normalizeTurnScopeIdKey } from "../../infra/messageIdentity";

export const DEFAULT_TERMINAL_RETAIN_PER_SESSION = 10;
export const DEFAULT_TERMINAL_MAX_AGE_MS = TIME_THRESHOLDS.client.terminalTurnRetentionMs;

function text(value) {
  return String(value || "").trim();
}

function turnKey(value) {
  return normalizeTurnScopeIdKey(value);
}

export function executionTurnKey(sessionId, turnScopeId) {
  const normalizedSessionId = text(sessionId);
  const normalizedTurnScopeId = turnKey(turnScopeId);
  return normalizedSessionId && normalizedTurnScopeId
    ? `${normalizedSessionId}::${normalizedTurnScopeId}`
    : "";
}

function executionFingerprint(value = {}) {
  const normalize = (input) => {
    if (Array.isArray(input)) return input.map(normalize);
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(Object.keys(input).sort().map((key) => [key, normalize(input[key])]));
  };
  return JSON.stringify(normalize(value));
}

export function sessionRuntimeId(value = {}) {
  return text(value?.backendSessionId || value?.sessionId || value?.id || value);
}

export function createTurnRuntimeRegistryState() {
  return { sessions: {}, routeIndex: {}, executions: {}, executionIdByTurnScopeId: {}, childExecutionIdsByParentId: {} };
}

function removeExecutionProjection(registry, executionId) {
  const execution = registry?.executions?.[executionId];
  if (!execution) return false;
  const parentId = text(execution?.parentExecutionId);
  if (parentId && registry.childExecutionIdsByParentId?.[parentId]) {
    registry.childExecutionIdsByParentId[parentId] = registry.childExecutionIdsByParentId[parentId]
      .filter((id) => id !== executionId);
    if (!registry.childExecutionIdsByParentId[parentId].length) {
      delete registry.childExecutionIdsByParentId[parentId];
    }
  }
  const indexedTurnKey = executionTurnKey(execution?.sessionId, execution?.turnScopeId);
  if (indexedTurnKey && registry.executionIdByTurnScopeId?.[indexedTurnKey] === executionId) {
    delete registry.executionIdByTurnScopeId[indexedTurnKey];
  }
  delete registry.executions[executionId];
  delete registry.childExecutionIdsByParentId?.[executionId];
  return true;
}

function applyExecutionProjection(registry, source = {}) {
  const validation = validateExecutionIdentity(source);
  if (!validation.valid) return { applied: false, reason: "invalid_execution_identity", errors: validation.errors };
  const current = registry.executions?.[validation.identity.executionId];
  const rawTurnScopeId = text(validation.identity?.turnScopeId || source?.turnScopeId);
  const canonicalTurnScopeId = turnKey(rawTurnScopeId);
  const execution = {
    ...(current || {}),
    ...source,
    ...validation.identity,
    ...(canonicalTurnScopeId ? { turnScopeId: canonicalTurnScopeId } : {}),
    ...(rawTurnScopeId && rawTurnScopeId !== canonicalTurnScopeId
      ? { protocolTurnScopeId: rawTurnScopeId }
      : {}),
  };
  if (current && (Number(current.revision || 0) > Number(execution.revision || 0)
    || (Number(current.revision || 0) === Number(execution.revision || 0) && Number(current.sequence || 0) > Number(execution.sequence || 0)))) {
    return { applied: false, reason: "stale_execution" };
  }
  if (current && Number(current.revision || 0) === Number(execution.revision || 0)
    && Number(current.sequence || 0) === Number(execution.sequence || 0)) {
    const currentComparable = { ...current };
    const executionComparable = { ...execution };
    delete currentComparable._projectionFingerprint;
    delete executionComparable._projectionFingerprint;
    if (executionFingerprint(currentComparable) === executionFingerprint(executionComparable)) {
      return { applied: false, deduplicated: true, reason: "duplicate_execution" };
    }
    return { applied: false, reason: "execution_sequence_conflict" };
  }
  if (!registry.executions) registry.executions = {};
  if (!registry.executionIdByTurnScopeId) registry.executionIdByTurnScopeId = {};
  if (!registry.childExecutionIdsByParentId) registry.childExecutionIdsByParentId = {};
  const previousParentExecutionId = text(current?.parentExecutionId);
  if (previousParentExecutionId && previousParentExecutionId !== execution.parentExecutionId) {
    registry.childExecutionIdsByParentId[previousParentExecutionId] =
      (registry.childExecutionIdsByParentId[previousParentExecutionId] || []).filter((id) => id !== execution.executionId);
    if (!registry.childExecutionIdsByParentId[previousParentExecutionId].length) {
      delete registry.childExecutionIdsByParentId[previousParentExecutionId];
    }
  }
  registry.executions[execution.executionId] = execution;
  const indexedTurnKey = executionTurnKey(execution.sessionId, execution.turnScopeId);
  if (indexedTurnKey) registry.executionIdByTurnScopeId[indexedTurnKey] = execution.executionId;
  if (execution.parentExecutionId) {
    const children = new Set(registry.childExecutionIdsByParentId[execution.parentExecutionId] || []);
    children.add(execution.executionId);
    registry.childExecutionIdsByParentId[execution.parentExecutionId] = [...children];
  }
  return { applied: true, execution };
}

export function applyExecutionSnapshot(registry, payload = {}) {
  return applyExecutionProjection(registry, payload?.execution || payload);
}

export function applyExecutionChildren(registry, payload = {}) {
  const results = [payload?.execution, ...(Array.isArray(payload?.children) ? payload.children : [])]
    .filter(Boolean).map((item) => applyExecutionProjection(registry, item));
  return { applied: results.some((item) => item.applied), results };
}

export function applyExecutionTree(registry, payload = {}) {
  const rootExecutionId = text(payload?.rootExecutionId);
  const incoming = Object.values(payload?.tree?.executions || {});
  if (!rootExecutionId) return { applied: false, reason: "invalid_execution_tree_root", results: [], rootExecutionId };
  const validations = incoming.map((item) => validateExecutionIdentity(item));
  if (validations.some((item) => !item.valid)) {
    return {
      applied: false,
      reason: "invalid_execution_tree",
      errors: validations.flatMap((item) => item.errors || []),
      results: [],
      rootExecutionId,
    };
  }
  if (validations.some(({ identity }) => identity.executionId !== rootExecutionId && identity.rootExecutionId !== rootExecutionId)) {
    return { applied: false, reason: "execution_tree_root_conflict", results: [], rootExecutionId };
  }
  // A plain tree snapshot has no tree-wide revision/tombstone coordinate. It
  // is therefore an authoritative view of the entries it contains, but NOT
  // proof that a locally newer lifecycle projection was deleted. Destructive
  // removal is only accepted through explicit, versioned tombstones. This
  // prevents a delayed reconnect tree from deleting a child introduced by a
  // newer lifecycle envelope while the request was in flight.
  const tombstones = Array.isArray(payload?.removedExecutions) ? payload.removedExecutions : [];
  const removedExecutionIds = [];
  const acceptedTombstones = new Map();
  for (const tombstone of tombstones) {
    const executionId = text(tombstone?.executionId);
    const current = registry?.executions?.[executionId];
    const revision = Number(tombstone?.revision);
    const sequence = Number(tombstone?.sequence);
    if (!executionId || !current || text(current?.rootExecutionId || current?.executionId) !== rootExecutionId) continue;
    if (!Number.isInteger(revision) || revision < 1 || !Number.isInteger(sequence) || sequence < 1) continue;
    if (Number(current.revision || 0) > revision
      || (Number(current.revision || 0) === revision && Number(current.sequence || 0) >= sequence)) continue;
    if (removeExecutionProjection(registry, executionId)) {
      removedExecutionIds.push(executionId);
      acceptedTombstones.set(executionId, { revision, sequence });
    }
  }
  const results = incoming
    .filter((item = {}) => {
      const tombstone = acceptedTombstones.get(text(item.executionId));
      if (!tombstone) return true;
      const revision = Number(item.revision || 0);
      const sequence = Number(item.sequence || 0);
      return revision > tombstone.revision ||
        (revision === tombstone.revision && sequence > tombstone.sequence);
    })
    .map((item) => applyExecutionProjection(registry, item));
  return { applied: removedExecutionIds.length > 0 || results.some((item) => item.applied), results, removedExecutionIds, rootExecutionId };
}

export function selectExecution(registry, executionId) {
  return registry?.executions?.[text(executionId)] || null;
}

export function selectExecutionChildren(registry, executionId) {
  return (registry?.childExecutionIdsByParentId?.[text(executionId)] || [])
    .map((id) => registry?.executions?.[id]).filter(Boolean);
}

function ensureSessionBucket(registry, sessionId) {
  const id = text(sessionId);
  if (!registry.sessions) registry.sessions = {};
  if (!registry.routeIndex) registry.routeIndex = {};
  if (!registry.sessions[id]) registry.sessions[id] = { activeTurnScopeId: "", authoritativeSequence: 0, protocolVersion: 0, turns: {} };
  return registry.sessions[id];
}

function findTurnByScope(registry, turnScopeId, { sessionId = "" } = {}) {
  const scope = turnKey(turnScopeId);
  if (!scope) return null;
  const id = text(sessionId);
  if (id) return registry?.sessions?.[id]?.turns?.[scope] || null;
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
  const scope = turnKey(turnScopeId);
  const id = text(sessionId);
  if (!scope) return null;
  return findTurnByScope(registry, scope, { sessionId: id });
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
  const defaultRuntimeView = {
    state: "",
    backendState: "",
    sessionId: normalizedSessionId,
    turnScopeId: turnKey(turnScopeId),
    dialogProcessId: normalizedDialogProcessId,
    source: "",
    sourceEvent: "",
    seq: 0,
    updatedAt: "",
    updatedAtMs: 0,
    terminal: null,
    running: false,
    startedAt: "",
    finishedAt: "",
  };
  let normalizedTurnScopeId = turnKey(turnScopeId);
  let routeSessionId = "";
  if (!normalizedTurnScopeId && normalizedDialogProcessId) {
    const route = resolveRoute(registry, normalizedDialogProcessId);
    normalizedTurnScopeId = turnKey(route?.turnScopeId);
    routeSessionId = text(route?.sessionId);
  }
  const turn = normalizedTurnScopeId
    ? resolveTurnRuntimeByScope(registry, normalizedTurnScopeId, { sessionId: normalizedSessionId || routeSessionId })
    : null;
  if (!turn) {
    // Distinguish an unknown Turn (safe empty projection) from a known Turn
    // owned by another Session (identity mismatch). This prevents cross-session
    // leakage without forcing callers to null-check genuinely absent runtime.
    const turnInAnotherSession = normalizedSessionId && normalizedTurnScopeId
      ? resolveTurnRuntimeByScope(registry, normalizedTurnScopeId)
      : null;
    return turnInAnotherSession ? null : defaultRuntimeView;
  }
  if (normalizedSessionId && turn.sessionId !== normalizedSessionId) return null;
  // sessionId + canonical turnScopeId is the authoritative Turn identity.
  // dialogProcessId is only a routing aid when the scope is absent; workflow
  // projections may legitimately carry a parent/graph dialog id here.
  const state = turn.state === BackendChannelState.SENDING
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
    running: !turn.terminal && [
      FrontendRunState.ACTION_REQUESTING,
      FrontendRunState.PROCESSING,
      FrontendRunState.FRONTEND_COMPLETION_REQUESTING,
      FrontendRunState.USER_STOPPING,
      BackendChannelState.SENDING,
      BackendChannelState.RECONNECTING,
      BackendChannelState.INTERACTION_PENDING,
    ].includes(turn.state),
    startedAt: turn.startedAt || turn.thinkingStartedAt || "",
    finishedAt: turn.finishedAt || turn.thinkingFinishedAt || "",
  };
}

export function resolveLatestStoppedTurn(registry, sessionId) {
  const bucket = registry?.sessions?.[text(sessionId)];
  return Object.values(bucket?.turns || {})
    .filter((turn) => turn.terminal === "user_stopped")
    .sort((a, b) => Number(b.finishedAtMs || b.updatedAtMs || 0) - Number(a.finishedAtMs || a.updatedAtMs || 0))[0] || null;
}

export function removeTurnRuntime(registry, turnScopeId, { sessionId = "" } = {}) {
  const scope = turnKey(turnScopeId);
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
  const referenced = new Set(Array.from(referencedTurnScopeIds || [], turnKey).filter(Boolean));
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
  let turnScopeId = turnKey(event.turnScopeId);
  const route = resolveRoute(next, event.dialogProcessId);
  if (!turnScopeId && route) turnScopeId = turnKey(route.turnScopeId);
  if (!turnScopeId) return { registry: next, turn: null, applied: false, reason: "missing_turn_identity" };
  const requestedSessionId = text(event.sessionId || route?.sessionId);
  const current = findTurnByScope(next, turnScopeId, { sessionId: requestedSessionId });
  const sessionId = text(requestedSessionId || current?.sessionId);
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
  const backendState = text(event.backendState || current?.backendState);
  const turn = {
    ...(current || {}),
    ...transition.next,
    sessionId,
    turnScopeId,
    dialogProcessId: text(event.dialogProcessId || current?.dialogProcessId),
    action: transition.next.action,
    backendState,
    state: transition.next.state,
    terminal,
    canStop: deriveTurnCapabilities(transition.next.state, { backendState }).canStop,
    seq: transition.next.seq,
    updatedAtMs: nowMs,
    updatedAt: text(event.updatedAt || current?.updatedAt),
    source: text(event.source || current?.source),
    sourceEvent: text(event.sourceEvent || event.type || current?.sourceEvent),
    finishedAtMs: terminal ? Number(current?.finishedAtMs || nowMs) : 0,
    // An existing Turn owns its start time. Only the event that creates a Turn
    // may derive a provisional start from its event time; later events must not
    // move the timer forward. Hydration below can still replace this provisional
    // value with the persisted canonical turnTimings value.
    startedAt: text(
      current?.startedAt ||
      rawEvent?.thinkingStartedAt ||
      rawEvent?.startedAt ||
      (!current ? (event.updatedAt || event.timestamp) : ""),
    ),
    finishedAt: terminal
      ? text(current?.finishedAt || rawEvent?.thinkingFinishedAt || rawEvent?.finishedAt || event.updatedAt)
      : text(current?.finishedAt),
    error: terminal === "error" ? text(rawEvent?.error?.message || rawEvent?.error || rawEvent?.reason) : null,
  };
  const bucket = ensureSessionBucket(next, sessionId);
  bucket.turns[turnScopeId] = turn;
  bucket.activeTurnScopeId = turnScopeId;
  if (turn.dialogProcessId) next.routeIndex[turn.dialogProcessId] = { sessionId, turnScopeId };
  return { registry: next, turn, applied: true, reason: transition.reason };
}

/** Apply a validated Service lifecycle envelope through the only Turn reducer. */
export function applyTurnLifecycleEnvelope(registry, envelope = {}) {
  const validation = validateTurnLifecycleEnvelope(envelope);
  if (!validation.valid) {
    return {
      registry,
      turn: null,
      applied: false,
      reason: "invalid_authoritative_envelope",
      errors: validation.errors,
    };
  }
  const result = applyTurnRuntimeEvent(registry, {
    ...envelope,
    type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
    seq: Number(envelope?.sequence || 0),
    source: "turn_lifecycle",
  });
  if (result.applied) {
    const bucket = ensureSessionBucket(registry, envelope.sessionId);
    bucket.authoritativeSequence = Math.max(Number(bucket.authoritativeSequence || 0), Number(envelope.sequence || 0));
    bucket.protocolVersion = Number(envelope.protocolVersion || 1);
    applyExecutionProjection(registry, envelope);
  }
  return result;
}

const SNAPSHOT_STATE_EVENT = Object.freeze({
  action_requesting: "turn.action_accepted",
  processing: "turn.processing_started",
  completion_requesting: "turn.processing_completed",
  completed: "turn.completed",
  stopping: "turn.stop_processing_completed",
  stop_completed: "turn.stop_completed",
  action_failed: "turn.failed",
  processing_failed: "turn.failed",
  completion_failed: "turn.failed",
  stop_failed: "turn.failed",
});

/** Merge a Session-scoped authoritative snapshot without replaying synthetic history. */
export function applyTurnLifecycleSnapshot(registry, snapshot = {}) {
  const validation = validateTurnLifecycleSnapshot(snapshot);
  if (!validation.valid) return { applied: false, reason: "invalid_authoritative_snapshot", errors: validation.errors };
  const sessionId = text(snapshot.sessionId);
  const sequence = Number(snapshot.sequence || 0);
  if (!sessionId || !Number.isInteger(sequence) || sequence < 0) return { applied: false, reason: "invalid_snapshot_identity" };
  const bucket = ensureSessionBucket(registry, sessionId);
  if (Number(bucket.authoritativeSequence || 0) > sequence) return { applied: false, reason: "stale_snapshot" };
  const fingerprint = JSON.stringify(snapshot);
  if (Number(bucket.authoritativeSequence || 0) === sequence && bucket.authoritativeSnapshotFingerprint) {
    if (bucket.authoritativeSnapshotFingerprint === fingerprint) return { applied: false, deduplicated: true, reason: "duplicate_snapshot" };
    return { applied: false, reason: "snapshot_sequence_conflict" };
  }
  const turns = [snapshot.activeTurn, ...(Array.isArray(snapshot.recentTerminalTurns) ? snapshot.recentTerminalTurns : [])].filter(Boolean);
  for (const source of turns) {
    const turnScopeId = turnKey(source.turnScopeId);
    const revision = Number(source.revision || 0);
    if (!turnScopeId || !Number.isInteger(revision) || revision < 1 || Number(source.sequence || 0) > sequence) {
      return { applied: false, reason: "invalid_snapshot_turn" };
    }
    const current = bucket.turns[turnScopeId];
    if (current && Number(current.revision || 0) > revision) continue;
    if (current?.dialogProcessId && source.dialogProcessId && text(current.dialogProcessId) !== text(source.dialogProcessId)) {
      return { applied: false, reason: "dialog_process_identity_conflict" };
    }
    const eventType = SNAPSHOT_STATE_EVENT[text(source.state)];
    if (!eventType) return { applied: false, reason: "invalid_snapshot_state" };
    const phase = text(source.phase || source.failure?.phase);
    const stateMap = {
      action_requesting: FrontendRunState.ACTION_REQUESTING, processing: FrontendRunState.PROCESSING,
      completion_requesting: FrontendRunState.FRONTEND_COMPLETION_REQUESTING, completed: FrontendRunState.FRONTEND_COMPLETED,
      stopping: FrontendRunState.USER_STOPPING, stop_completed: FrontendRunState.USER_STOP_COMPLETED,
      action_failed: FrontendRunState.ACTION_REQUEST_ERROR, processing_failed: FrontendRunState.PROCESSING_ERROR,
      completion_failed: FrontendRunState.COMPLETION_ERROR, stop_failed: FrontendRunState.STOP_ERROR,
    };
    const state = stateMap[text(source.state)];
    const terminal = text(source.state) === "completed" ? "completed" : text(source.state) === "stop_completed" ? "user_stopped" : isFinalTurnState(state) ? "error" : null;
    const turn = { ...(current || {}), ...source, sessionId, turnScopeId, dialogProcessId: text(source.dialogProcessId), state, phase, revision, seq: Number(source.sequence || 0), backendState: text(source.executionState), canStop: source.capabilities?.canStop === true, terminal, startedAt: text(source.startedAt || source.thinkingStartedAt || current?.startedAt), finishedAt: terminal ? text(current?.finishedAt || source.finishedAt || source.thinkingFinishedAt || source.updatedAt) : text(current?.finishedAt), source: "turn_snapshot", authoritativeSnapshot: true, authoritativeLifecycle: true };
    bucket.turns[turnScopeId] = turn;
    if (turn.dialogProcessId) registry.routeIndex[turn.dialogProcessId] = { sessionId, turnScopeId };
  }
  const previousActiveTurnScopeId = text(bucket.activeTurnScopeId);
  bucket.activeTurnScopeId = turnKey(snapshot.activeTurnScopeId);
  if (!bucket.activeTurnScopeId && previousActiveTurnScopeId) {
    const previous = bucket.turns[previousActiveTurnScopeId];
    if (previous?.dialogProcessId) delete registry.routeIndex[previous.dialogProcessId];
  }
  bucket.authoritativeSequence = sequence;
  bucket.protocolVersion = Number(snapshot.protocolVersion || 1);
  bucket.authoritativeSnapshotFingerprint = fingerprint;
  return { applied: true, bucket };
}

export function hydrateSessionTurnRuntime(registry, session, turnStatuses = session?.turnStatuses || []) {
  const sessionId = sessionRuntimeId(session);
  if (!sessionId) return { registry, applied: false, reason: "missing_session_identity" };
  // turnStatuses is a legacy summary projection. Once this Session has seen
  // the authoritative lifecycle protocol it must never drive the state
  // machine again (watchers may invoke hydration repeatedly).
  if (Number(registry?.sessions?.[sessionId]?.protocolVersion || 0) > 0) {
    return { registry, applied: false, reason: "authoritative_protocol_present" };
  }
  let applied = false;
  for (const status of Array.isArray(turnStatuses) ? turnStatuses : []) {
    const turnScopeId = turnKey(status?.turnScopeId);
    if (!turnScopeId) continue;
    const scope = { sessionId, turnScopeId, dialogProcessId: status?.dialogProcessId, updatedAt: status?.updatedAt, authoritativeSnapshot: true, source: "session_summary_replay" };
    const terminalStatus = text(status?.status).toLowerCase();
    applied = applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED, ...scope, dialogProcessId: "", seq: 0 }).applied || applied;
    applied = applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, ...scope, state: BackendChannelState.SENDING, seq: 0 }).applied || applied;
    if (terminalStatus === BackendChannelState.USER_STOPPED) {
      applied = applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUESTED, ...scope, seq: 0 }).applied || applied;
      applied = applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, ...scope, state: BackendChannelState.USER_STOPPED, seq: 0 }).applied || applied;
      applied = applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_APPLIED, ...scope, seq: Number(status?.seq || 0) }).applied || applied;
    } else if (terminalStatus === BackendChannelState.COMPLETED) {
      applied = applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, ...scope, state: BackendChannelState.COMPLETED, seq: 0 }).applied || applied;
      applied = applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED, ...scope, seq: Number(status?.seq || 0) }).applied || applied;
    } else {
      applied = applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, ...scope, state: terminalStatus, seq: Number(status?.seq || 0) }).applied || applied;
    }
  }
  const timings = Array.isArray(session?.turnTimings) ? session.turnTimings : [];
  for (const timing of timings) {
    const turnScopeId = turnKey(timing?.turnScopeId);
    const turn = turnScopeId ? registry?.sessions?.[sessionId]?.turns?.[turnScopeId] : null;
    if (!turn) continue;
    const startedAt = text(timing?.thinkingStartedAt);
    const finishedAt = text(timing?.thinkingFinishedAt);
    // Persisted timing is the canonical source on refresh.  Hydration events
    // may have created the turn without an explicit start timestamp, and must
    // never replace this value with status.updatedAt/now.
    if (startedAt && turn.startedAt !== startedAt) {
      turn.startedAt = startedAt;
      applied = true;
    }
    if (finishedAt && turn.finishedAt !== finishedAt) {
      turn.finishedAt = finishedAt;
      applied = true;
    }
  }
  return { registry, applied };
}
