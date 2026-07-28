/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  BackendChannelState,
  FrontendRunState,
  SESSION_RUN_EVENT,
  isAuthoritativeTerminalState,
} from "./constants.js";
import { normalizeSessionRunEvent } from "./eventNormalization.js";
import { deriveTurnCapabilities, isFinalTurnState, reduceTurnRuntimeEvent } from "./turnReducer.js";
import {
  validateTurnLifecycleEnvelope,
  validateTurnLifecycleSnapshot,
  validateTurnTerminalResolution,
} from "@noobot/shared/turn-lifecycle-protocol";
import { validateExecutionIdentity } from "@noobot/shared/execution-lifecycle-protocol";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { normalizeTurnScopeIdKey } from "../../model/messageIdentity.js";

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
  return {
    sessions: {}, sessionAliases: {}, routeIndex: {},
    executions: {}, executionIdByTurnScopeId: {}, childExecutionIdsByParentId: {},
    deletedTurnScopeIdsBySession: {},
  };
}

function canonicalSessionId(registry, sessionId) {
  let id = text(sessionId);
  const visited = new Set();
  while (id && registry?.sessionAliases?.[id] && !visited.has(id)) {
    visited.add(id);
    id = text(registry.sessionAliases[id]);
  }
  return id;
}

export function isTurnRuntimeDeleted(registry, { sessionId = "", turnScopeId = "" } = {}) {
  const id = canonicalSessionId(registry, sessionId);
  const scope = turnKey(turnScopeId);
  return Boolean(id && scope && registry?.deletedTurnScopeIdsBySession?.[id]?.[scope]);
}

function tombstoneTurnRuntime(registry, sessionId, turnScopeId) {
  const id = canonicalSessionId(registry, sessionId) || text(sessionId);
  const scope = turnKey(turnScopeId);
  if (!id || !scope) return false;
  if (!registry.deletedTurnScopeIdsBySession) registry.deletedTurnScopeIdsBySession = {};
  if (!registry.deletedTurnScopeIdsBySession[id]) registry.deletedTurnScopeIdsBySession[id] = {};
  const added = registry.deletedTurnScopeIdsBySession[id][scope] !== true;
  registry.deletedTurnScopeIdsBySession[id][scope] = true;
  return added;
}

function promoteTurnSession(registry, turn, nextSessionId) {
  const previousSessionId = text(turn?.sessionId);
  const promotedSessionId = text(nextSessionId);
  if (!previousSessionId || !promotedSessionId || previousSessionId === promotedSessionId) return turn;
  const scope = turnKey(turn.turnScopeId);
  const previousBucket = registry?.sessions?.[previousSessionId];
  const nextBucket = ensureSessionBucket(registry, promotedSessionId);
  if (nextBucket.turns?.[scope] && nextBucket.turns[scope] !== turn) return null;
  delete previousBucket?.turns?.[scope];
  if (previousBucket?.activeTurnScopeId === scope) previousBucket.activeTurnScopeId = "";
  turn.sessionId = promotedSessionId;
  nextBucket.turns[scope] = turn;
  nextBucket.activeTurnScopeId = scope;
  if (!registry.sessionAliases) registry.sessionAliases = {};
  registry.sessionAliases[previousSessionId] = promotedSessionId;
  if (turn.dialogProcessId) registry.routeIndex[turn.dialogProcessId] = { sessionId: promotedSessionId, turnScopeId: scope };
  if (previousBucket && !Object.keys(previousBucket.turns || {}).length) delete registry.sessions[previousSessionId];
  return turn;
}

export function promoteSessionRuntimeIdentity(registry, previousSessionId, nextSessionId) {
  const previousId = canonicalSessionId(registry, previousSessionId);
  const nextId = canonicalSessionId(registry, nextSessionId) || text(nextSessionId);
  if (!previousId || !nextId || previousId === nextId) return { applied: false, reason: "identity_unchanged" };
  const previousBucket = registry?.sessions?.[previousId];
  const previousTombstones = registry?.deletedTurnScopeIdsBySession?.[previousId];
  if (!previousBucket && !previousTombstones) return { applied: false, reason: "source_session_runtime_missing" };
  const targetBucket = ensureSessionBucket(registry, nextId);
  for (const [scope, turn] of Object.entries(previousBucket?.turns || {})) {
    const existing = targetBucket.turns?.[scope];
    if (existing && existing !== turn) return { applied: false, reason: "session_identity_conflict" };
  }
  for (const [scope, turn] of Object.entries(previousBucket?.turns || {})) {
    turn.sessionId = nextId;
    targetBucket.turns[scope] = turn;
    if (turn.dialogProcessId) registry.routeIndex[turn.dialogProcessId] = { sessionId: nextId, turnScopeId: scope };
  }
  if (previousBucket?.activeTurnScopeId) targetBucket.activeTurnScopeId = previousBucket.activeTurnScopeId;
  targetBucket.authoritativeSequence = Math.max(Number(targetBucket.authoritativeSequence || 0), Number(previousBucket?.authoritativeSequence || 0));
  targetBucket.protocolVersion = Math.max(Number(targetBucket.protocolVersion || 0), Number(previousBucket?.protocolVersion || 0));
  if (previousTombstones) {
    if (!registry.deletedTurnScopeIdsBySession[nextId]) registry.deletedTurnScopeIdsBySession[nextId] = {};
    Object.assign(registry.deletedTurnScopeIdsBySession[nextId], previousTombstones);
    delete registry.deletedTurnScopeIdsBySession[previousId];
  }
  registry.sessionAliases[previousId] = nextId;
  delete registry.sessions[previousId];
  return { applied: true, previousSessionId: previousId, sessionId: nextId };
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
  if (isTurnRuntimeDeleted(registry, {
    sessionId: validation.identity?.sessionId || source?.sessionId,
    turnScopeId: canonicalTurnScopeId,
  })) return { applied: false, reason: "deleted_turn_tombstoned" };
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

function findTurnsByScope(registry, turnScopeId) {
  const scope = turnKey(turnScopeId);
  if (!scope) return [];
  return Object.values(registry?.sessions || {})
    .map((bucket) => bucket?.turns?.[scope])
    .filter(Boolean);
}

function isBackendRuntimeEvent(type) {
  return text(type).startsWith("backend_");
}

function canPromoteOptimisticTurnSession(event = {}) {
  return isBackendRuntimeEvent(event.type) || [
    SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_REQUEST_STARTED,
    SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_FAILED,
  ].includes(event.type);
}

function isOptimisticLocalTurn(turn) {
  return turn?.sessionIdentityPending === true;
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

export function resolveSessionTurnRuntime(registry, sessionId, turnScopeId = "") {
  const bucket = registry?.sessions?.[canonicalSessionId(registry, sessionId)];
  const scope = turnKey(turnScopeId) || turnKey(bucket?.activeTurnScopeId);
  return scope ? bucket?.turns?.[scope] || null : null;
}

export function resolveTurnRuntimeByScope(registry, turnScopeId, { sessionId = "" } = {}) {
  const scope = turnKey(turnScopeId);
  const id = canonicalSessionId(registry, sessionId);
  if (!scope) return null;
  return findTurnByScope(registry, scope, { sessionId: id });
}

export function selectSessionTurnRuntime(registry, sessionId, turnScopeId = "") {
  const normalizedSessionId = text(sessionId);
  const turn = resolveSessionTurnRuntime(registry, normalizedSessionId, turnScopeId);
  const displayState = turnRuntimeDisplayState(turn);
  return {
    sessionId: normalizedSessionId,
    turnScopeId: text(turn?.turnScopeId),
    dialogProcessId: text(turn?.dialogProcessId),
    action: text(turn?.action),
    commandId: text(turn?.commandId),
    actionCommandId: text(turn?.actionCommandId),
    lifecycleEventType: text(turn?.lifecycleEventType),
    lifecycleObserved: turn?.lifecycleObserved === true,
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
    const turnInAnotherSession = normalizedSessionId && normalizedTurnScopeId
      ? resolveTurnRuntimeByScope(registry, normalizedTurnScopeId)
      : null;
    return turnInAnotherSession ? null : defaultRuntimeView;
  }
  if (normalizedSessionId && turn.sessionId !== normalizedSessionId) return null;
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
    authority: turn.authority || "none",
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
  if (!registry) return false;
  const scope = turnKey(turnScopeId);
  const expectedSessionId = canonicalSessionId(registry, sessionId) || text(sessionId);
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

export function confirmTurnRuntimeDeletion(registry, turnScopeIds = [], { sessionId = "" } = {}) {
  if (!registry) return { applied: false, confirmedTurnScopeIds: [], removedTurnScopeIds: [] };
  const id = canonicalSessionId(registry, sessionId) || text(sessionId);
  const scopes = [...new Set(
    (Array.isArray(turnScopeIds) ? turnScopeIds : [turnScopeIds]).map(turnKey).filter(Boolean),
  )];
  const confirmedTurnScopeIds = [];
  const removedTurnScopeIds = [];
  for (const scope of scopes) {
    if (tombstoneTurnRuntime(registry, id, scope)) confirmedTurnScopeIds.push(scope);
    if (removeTurnRuntime(registry, scope, { sessionId: id })) removedTurnScopeIds.push(scope);
  }
  return {
    applied: confirmedTurnScopeIds.length > 0 || removedTurnScopeIds.length > 0,
    confirmedTurnScopeIds,
    removedTurnScopeIds,
  };
}

export function removeSessionRuntime(registry, sessionId) {
  const id = canonicalSessionId(registry, sessionId) || text(sessionId);
  const bucket = registry?.sessions?.[id];
  const hadTombstones = Boolean(registry?.deletedTurnScopeIdsBySession?.[id]);
  if (!bucket && !hadTombstones) return false;
  for (const turn of Object.values(bucket?.turns || {})) {
    const route = registry.routeIndex?.[text(turn?.dialogProcessId)];
    if (route?.sessionId === id && route?.turnScopeId === turn.turnScopeId) delete registry.routeIndex[turn.dialogProcessId];
  }
  delete registry.sessions[id];
  delete registry.deletedTurnScopeIdsBySession?.[id];
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
  if (!next.sessionAliases) next.sessionAliases = {};
  if (!next.routeIndex) next.routeIndex = {};
  const event = normalizeSessionRunEvent(rawEvent);
  let turnScopeId = turnKey(event.turnScopeId);
  const route = resolveRoute(next, event.dialogProcessId);
  if (!turnScopeId && route) turnScopeId = turnKey(route.turnScopeId);
  const observation = (values = {}) => ({
    registry: next,
    requestedSessionId: text(event.sessionId || route?.sessionId),
    canonicalSessionId: text(values.turn?.sessionId || values.canonicalSessionId),
    turnKey: executionTurnKey(values.turn?.sessionId || values.canonicalSessionId, turnScopeId),
    eventId: text(rawEvent?.eventId || rawEvent?.id),
    sequence: Number(event.seq || rawEvent?.sequence || 0),
    source: text(event.source || rawEvent?.source),
    authority: text(event.authority || rawEvent?.authority || "none"),
    aliasPromoted: false,
    ...values,
  });
  if (!turnScopeId) return observation({ turn: null, applied: false, reason: "missing_turn_identity" });
  const rawRequestedSessionId = text(event.sessionId || route?.sessionId);
  const requestedSessionId = canonicalSessionId(next, rawRequestedSessionId);
  if (isTurnRuntimeDeleted(next, { sessionId: requestedSessionId, turnScopeId })) {
    return observation({ turn: null, canonicalSessionId: requestedSessionId, applied: false, reason: "deleted_turn_tombstoned" });
  }
  let current = findTurnByScope(next, turnScopeId, { sessionId: requestedSessionId });
  let aliasPromoted = false;
  if (!current && requestedSessionId && canPromoteOptimisticTurnSession(event)) {
    const matchingTurns = findTurnsByScope(next, turnScopeId);
    if (matchingTurns.length > 1) {
      return observation({ turn: null, canonicalSessionId: requestedSessionId, applied: false, reason: "turn_scope_session_conflict" });
    }
    const existingTurn = matchingTurns[0];
    if (existingTurn && canPromoteOptimisticTurnSession(event) && isOptimisticLocalTurn(existingTurn)) {
      if (route && (turnKey(route.turnScopeId) !== turnScopeId || text(route.sessionId) !== text(existingTurn.sessionId))) {
        return observation({ turn: existingTurn, canonicalSessionId: requestedSessionId, applied: false, reason: "dialog_process_identity_conflict" });
      }
      current = promoteTurnSession(next, existingTurn, requestedSessionId);
      if (!current) return observation({ turn: existingTurn, canonicalSessionId: requestedSessionId, applied: false, reason: "session_identity_conflict" });
      aliasPromoted = true;
    }
  }
  const sessionId = text(requestedSessionId || current?.sessionId);
  const ignoresDialogRoute = event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED;
  const result = (values = {}) => observation({ canonicalSessionId: sessionId, aliasPromoted, ...values });
  if (!sessionId) return result({ turn: current, applied: false, reason: "missing_session_identity" });
  if (current?.sessionId && current.sessionId !== sessionId) return result({ turn: current, applied: false, reason: "session_identity_conflict" });
  if (!ignoresDialogRoute && current?.dialogProcessId && event.dialogProcessId && current.dialogProcessId !== event.dialogProcessId) return result({ turn: current, applied: false, reason: "dialog_process_identity_conflict" });
  if (!ignoresDialogRoute && route && (route.turnScopeId !== turnScopeId || route.sessionId !== sessionId)) {
    return result({ turn: current, applied: false, reason: "dialog_process_identity_conflict" });
  }
  const activeTurnScopeId = text(next?.sessions?.[canonicalSessionId(next, sessionId)]?.activeTurnScopeId);
  const activeTurn = resolveSessionTurnRuntime(next, sessionId, activeTurnScopeId);
  if (!current && activeTurn && !isFinalTurnState(activeTurn.state, activeTurn)) {
    return result({ turn: activeTurn, applied: false, reason: "active_turn_conflict" });
  }
  const transition = reduceTurnRuntimeEvent(current, rawEvent);
  if (!transition.applied) {
    return result({ turn: current, applied: false, reason: transition.reason });
  }
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
    authority: text(event.authority || current?.authority || "none"),
    sessionIdentityPending: current
      ? (aliasPromoted ? false : current.sessionIdentityPending === true)
      : text(event.type).startsWith("local_"),
    finishedAtMs: terminal ? Number(current?.finishedAtMs || nowMs) : 0,
    startedAt: text(
      event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED
        ? (rawEvent?.thinkingStartedAt || rawEvent?.startedAt || current?.startedAt)
        : (rawEvent?.canonicalTimingObserved === true
          ? (rawEvent?.thinkingStartedAt || rawEvent?.startedAt || current?.startedAt)
          : (current?.startedAt || rawEvent?.thinkingStartedAt || rawEvent?.startedAt ||
            (!current ? (event.updatedAt || event.timestamp) : "")))
    ),
    finishedAt: terminal
      ? text(event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED
        ? (rawEvent?.thinkingFinishedAt || rawEvent?.finishedAt || current?.finishedAt || event.updatedAt)
        : (current?.finishedAt || rawEvent?.thinkingFinishedAt || rawEvent?.finishedAt || event.updatedAt))
      : text(current?.finishedAt),
    error: terminal === "error" ? text(rawEvent?.error?.message || rawEvent?.error || rawEvent?.reason) : null,
  };
  const bucket = ensureSessionBucket(next, sessionId);
  bucket.turns[turnScopeId] = turn;
  bucket.activeTurnScopeId = turnScopeId;
  if (turn.dialogProcessId) next.routeIndex[turn.dialogProcessId] = { sessionId, turnScopeId };
  return result({ turn, applied: true, reason: transition.reason });
}

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

export function applyTurnTerminalResolution(registry, response = {}) {
  const validation = validateTurnTerminalResolution(response);
  if (!validation.valid || response.resolved !== true) {
    return { registry, applied: false, reason: response.resolved === false ? "terminal_unresolved" : "invalid_terminal_resolution", errors: validation.errors };
  }
  const turn = response.turn || {};
  return applyTurnRuntimeEvent(registry, {
    ...turn,
    type: SESSION_RUN_EVENT.TERMINAL_RESOLVED,
    sessionId: response.sessionId,
    turnScopeId: response.turnScopeId,
    state: turn.state,
    seq: Number(turn.sequence || 0),
    revision: Number(turn.revision || 0),
    completionCommitId: turn.completionCommitId,
    summaryVersion: turn.summaryVersion,
    finalizeIntent: turn.finalizeIntent,
    failure: turn.failure,
    materialization: response.materialization,
    raw: { turn },
    source: "authoritative_terminal_service",
  });
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
    if (isTurnRuntimeDeleted(registry, { sessionId, turnScopeId })) continue;
    const current = bucket.turns[turnScopeId];
    if (current && Number(current.revision || 0) > revision) continue;
    if (current?.dialogProcessId && source.dialogProcessId && text(current.dialogProcessId) !== text(source.dialogProcessId)) {
      return { applied: false, reason: "dialog_process_identity_conflict" };
    }
    const eventType = SNAPSHOT_STATE_EVENT[text(source.state)];
    if (!eventType) return { applied: false, reason: "invalid_snapshot_state" };
    const sourceIsTerminal = isAuthoritativeTerminalState(source.state);
    if (sourceIsTerminal) continue;
    const phase = text(source.phase || source.failure?.phase);
    const stateMap = {
      action_requesting: FrontendRunState.ACTION_REQUESTING, processing: FrontendRunState.PROCESSING,
      completion_requesting: FrontendRunState.FRONTEND_COMPLETION_REQUESTING, completed: FrontendRunState.FRONTEND_COMPLETED,
      stopping: FrontendRunState.USER_STOPPING, stop_completed: FrontendRunState.USER_STOP_COMPLETED,
      action_failed: FrontendRunState.ACTION_REQUEST_ERROR, processing_failed: FrontendRunState.PROCESSING_ERROR,
      completion_failed: FrontendRunState.COMPLETION_ERROR, stop_failed: FrontendRunState.STOP_ERROR,
    };
    const state = stateMap[text(source.state)];
    if (current && isFinalTurnState(current.state, current) && !isFinalTurnState(state, source)) continue;
    const terminal = null;
    const turn = { ...(current || {}), ...source, sessionId, turnScopeId, dialogProcessId: text(source.dialogProcessId), state, phase, revision, seq: Number(source.sequence || 0), backendState: text(source.executionState), canStop: source.capabilities?.canStop === true, terminal, actionCommandId: text(current?.actionCommandId || (text(source.action) === "stop" && text(source.state) === "action_requesting" ? source.commandId : "")), lifecycleEventType: SNAPSHOT_STATE_EVENT[text(source.state)] || text(current?.lifecycleEventType), authoritativeCompletionCommit: current?.authoritativeCompletionCommit || null, startedAt: text(source.startedAt || source.thinkingStartedAt || current?.startedAt), finishedAt: text(current?.finishedAt), source: "turn_snapshot", lifecycleSnapshotObserved: true, lifecycleObserved: true };
    bucket.turns[turnScopeId] = turn;
    if (turn.dialogProcessId) registry.routeIndex[turn.dialogProcessId] = { sessionId, turnScopeId };
  }
  const previousActiveTurnScopeId = text(bucket.activeTurnScopeId);
  const previousActiveTurn = previousActiveTurnScopeId
    ? bucket.turns[previousActiveTurnScopeId]
    : null;
  const candidateSnapshotActiveScope = turnKey(snapshot.activeTurnScopeId);
  const snapshotActiveScope = isTurnRuntimeDeleted(registry, {
    sessionId,
    turnScopeId: candidateSnapshotActiveScope,
  }) ? "" : candidateSnapshotActiveScope;
  const snapshotActiveState = text(snapshot.activeTurn?.state);
  const snapshotActiveIsTerminal = isAuthoritativeTerminalState(snapshotActiveState);
  bucket.activeTurnScopeId = previousActiveTurn?.terminal
    ? previousActiveTurnScopeId
    : snapshotActiveIsTerminal
      ? ""
      : snapshotActiveScope;
  if (!bucket.activeTurnScopeId && previousActiveTurnScopeId) {
    const previous = bucket.turns[previousActiveTurnScopeId];
    if (previous?.dialogProcessId) delete registry.routeIndex[previous.dialogProcessId];
  }
  bucket.authoritativeSequence = sequence;
  bucket.protocolVersion = Number(snapshot.protocolVersion || 1);
  bucket.authoritativeSnapshotFingerprint = fingerprint;
  return { applied: true, bucket };
}

export function applyTurnTimingSnapshot(registry, snapshot = {}) {
  const sessionId = text(snapshot?.sessionId);
  const sourceTimings = Array.isArray(snapshot?.turnTimings) ? snapshot.turnTimings : [];
  if (!sessionId) return { applied: false, reason: "missing_session_identity" };
  if (!sourceTimings.length) return { applied: false, reason: "empty_timing_snapshot" };
  const timings = sourceTimings.map((item = {}) => ({
    turnScopeId: turnKey(item?.turnScopeId),
    dialogProcessId: text(item?.dialogProcessId),
    startedAt: text(item?.thinkingStartedAt || item?.startedAt),
    finishedAt: text(item?.thinkingFinishedAt || item?.finishedAt),
  }));
  if (timings.some((item) => !item.turnScopeId || (!item.startedAt && !item.finishedAt))) {
    return { applied: false, reason: "invalid_timing_snapshot" };
  }
  const bucket = ensureSessionBucket(registry, sessionId);
  const hydratedTurnScopeIds = [];
  for (const timing of timings) {
    if (isTurnRuntimeDeleted(registry, { sessionId, turnScopeId: timing.turnScopeId })) continue;
    const current = bucket.turns[timing.turnScopeId] || {};
    if (
      current?.dialogProcessId &&
      timing.dialogProcessId &&
      text(current.dialogProcessId) !== timing.dialogProcessId
    ) {
      return { applied: false, reason: "dialog_process_identity_conflict" };
    }
    const startedAt = timing.startedAt || text(current.startedAt);
    const finishedAt = timing.finishedAt || text(current.finishedAt);
    const dialogProcessId = text(current.dialogProcessId || timing.dialogProcessId);
    if (
      text(current.startedAt) === startedAt &&
      text(current.finishedAt) === finishedAt &&
      text(current.dialogProcessId) === dialogProcessId &&
      current.canonicalTimingObserved === true
    ) continue;
    const next = {
      ...current,
      sessionId,
      turnScopeId: timing.turnScopeId,
      dialogProcessId,
      startedAt,
      finishedAt,
      startedAtMs: startedAt ? Date.parse(startedAt) || 0 : Number(current.startedAtMs || 0),
      finishedAtMs: finishedAt ? Date.parse(finishedAt) || 0 : Number(current.finishedAtMs || 0),
      canonicalTimingObserved: true,
      timingSource: "session_turn_timing_snapshot",
    };
    bucket.turns[timing.turnScopeId] = next;
    if (dialogProcessId) {
      registry.routeIndex[dialogProcessId] = { sessionId, turnScopeId: timing.turnScopeId };
    }
    hydratedTurnScopeIds.push(timing.turnScopeId);
  }
  return hydratedTurnScopeIds.length
    ? { applied: true, bucket, hydratedTurnScopeIds }
    : { applied: false, deduplicated: true, reason: "timing_snapshot_unchanged" };
}

export function hydrateSessionTurnRuntime(registry, session, turnStatuses = session?.turnStatuses || []) {
  const sessionId = sessionRuntimeId(session);
  if (!sessionId) return { registry, applied: false, reason: "missing_session_identity" };
  return { registry, applied: false, reason: "legacy_runtime_projection_disabled" };
}
