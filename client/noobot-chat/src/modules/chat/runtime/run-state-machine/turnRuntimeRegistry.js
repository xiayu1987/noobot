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
import { isFinalTurnState, reduceTurnRuntimeEvent } from "./turnReducer.js";
import {
  projectAuthoritativeTurnState,
  projectAuthoritativeTurnTerminal,
} from "./authoritativeTurnProjection.js";
import {
  validateTurnLifecycleEnvelope,
  validateTurnLifecycleSnapshot,
  validateTurnTerminalResolution,
} from "@noobot/session-protocol";
import { validateExecutionIdentity } from "@noobot/session-protocol/execution-lifecycle";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { canonicalizeTurnScopeId } from "../../model/messageIdentity.js";

export const DEFAULT_TERMINAL_RETAIN_PER_SESSION = 10;
export const DEFAULT_TERMINAL_MAX_AGE_MS = TIME_THRESHOLDS.client.terminalTurnRetentionMs;

function text(value) {
  return String(value || "").trim();
}

function turnKey(value) {
  // Runtime entities carry the protocol identity.  A map key must not leak
  // the transport/index encoding into state, logs, or UI projections.
  return canonicalizeTurnScopeId(value);
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
    return Object.fromEntries(
      Object.keys(input)
        .sort()
        .map((key) => [key, normalize(input[key])]),
    );
  };
  return JSON.stringify(normalize(value));
}

export function sessionRuntimeId(value = {}) {
  return text(value?.sessionId || value);
}

export function createTurnRuntimeRegistryState() {
  return {
    sessions: {},
    routeIndex: {},
    executions: {},
    executionIdByTurnScopeId: {},
    childExecutionIdsByParentId: {},
    deletedTurnScopeIdsBySession: {},
  };
}

function canonicalSessionId(registry, sessionId) {
  return text(sessionId);
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

function removeExecutionProjection(registry, executionId) {
  const execution = registry?.executions?.[executionId];
  if (!execution) return false;
  const parentId = text(execution?.parentExecutionId);
  if (parentId && registry.childExecutionIdsByParentId?.[parentId]) {
    registry.childExecutionIdsByParentId[parentId] = registry.childExecutionIdsByParentId[
      parentId
    ].filter((id) => id !== executionId);
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
  if (!validation.valid)
    return { applied: false, reason: "invalid_execution_identity", errors: validation.errors };
  const current = registry.executions?.[validation.identity.executionId];
  const rawTurnScopeId = text(validation.identity?.turnScopeId || source?.turnScopeId);
  const canonicalTurnScopeId = turnKey(rawTurnScopeId);
  if (
    isTurnRuntimeDeleted(registry, {
      sessionId: validation.identity?.sessionId || source?.sessionId,
      turnScopeId: canonicalTurnScopeId,
    })
  )
    return { applied: false, reason: "deleted_turn_tombstoned" };
  const execution = {
    ...(current || {}),
    ...source,
    ...validation.identity,
    ...(canonicalTurnScopeId ? { turnScopeId: canonicalTurnScopeId } : {}),
    ...(rawTurnScopeId && rawTurnScopeId !== canonicalTurnScopeId
      ? { protocolTurnScopeId: rawTurnScopeId }
      : {}),
  };
  if (
    current &&
    (Number(current.revision || 0) > Number(execution.revision || 0) ||
      (Number(current.revision || 0) === Number(execution.revision || 0) &&
        Number(current.sequence || 0) > Number(execution.sequence || 0)))
  ) {
    return { applied: false, reason: "stale_execution" };
  }
  if (
    current &&
    Number(current.revision || 0) === Number(execution.revision || 0) &&
    Number(current.sequence || 0) === Number(execution.sequence || 0)
  ) {
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
    registry.childExecutionIdsByParentId[previousParentExecutionId] = (
      registry.childExecutionIdsByParentId[previousParentExecutionId] || []
    ).filter((id) => id !== execution.executionId);
    if (!registry.childExecutionIdsByParentId[previousParentExecutionId].length) {
      delete registry.childExecutionIdsByParentId[previousParentExecutionId];
    }
  }
  registry.executions[execution.executionId] = execution;
  const indexedTurnKey = executionTurnKey(execution.sessionId, execution.turnScopeId);
  if (indexedTurnKey) registry.executionIdByTurnScopeId[indexedTurnKey] = execution.executionId;
  if (execution.parentExecutionId) {
    const children = new Set(
      registry.childExecutionIdsByParentId[execution.parentExecutionId] || [],
    );
    children.add(execution.executionId);
    registry.childExecutionIdsByParentId[execution.parentExecutionId] = [...children];
  }
  return { applied: true, execution };
}

export function applyExecutionSnapshot(registry, payload = {}) {
  return applyExecutionProjection(registry, payload?.execution || payload);
}

export function applyExecutionChildren(registry, payload = {}) {
  const results = [
    payload?.execution,
    ...(Array.isArray(payload?.children) ? payload.children : []),
  ]
    .filter(Boolean)
    .map((item) => applyExecutionProjection(registry, item));
  return { applied: results.some((item) => item.applied), results };
}

export function applyExecutionTree(registry, payload = {}) {
  const rootExecutionId = text(payload?.rootExecutionId);
  const incoming = Object.values(payload?.tree?.executions || {});
  if (!rootExecutionId)
    return { applied: false, reason: "invalid_execution_tree_root", results: [], rootExecutionId };
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
  if (
    validations.some(
      ({ identity }) =>
        identity.executionId !== rootExecutionId && identity.rootExecutionId !== rootExecutionId,
    )
  ) {
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
    if (
      !executionId ||
      !current ||
      text(current?.rootExecutionId || current?.executionId) !== rootExecutionId
    )
      continue;
    if (!Number.isInteger(revision) || revision < 1 || !Number.isInteger(sequence) || sequence < 1)
      continue;
    if (
      Number(current.revision || 0) > revision ||
      (Number(current.revision || 0) === revision && Number(current.sequence || 0) >= sequence)
    )
      continue;
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
      return (
        revision > tombstone.revision ||
        (revision === tombstone.revision && sequence > tombstone.sequence)
      );
    })
    .map((item) => applyExecutionProjection(registry, item));
  return {
    applied: removedExecutionIds.length > 0 || results.some((item) => item.applied),
    results,
    removedExecutionIds,
    rootExecutionId,
  };
}

export function selectExecution(registry, executionId) {
  return registry?.executions?.[text(executionId)] || null;
}

export function selectExecutionChildren(registry, executionId) {
  return (registry?.childExecutionIdsByParentId?.[text(executionId)] || [])
    .map((id) => registry?.executions?.[id])
    .filter(Boolean);
}

function ensureSessionBucket(registry, sessionId) {
  const id = text(sessionId);
  if (!registry.sessions) registry.sessions = {};
  if (!registry.routeIndex) registry.routeIndex = {};
  if (!registry.sessions[id])
    registry.sessions[id] = {
      activeTurnScopeId: "",
      authoritativeSequence: 0,
      protocolVersion: 0,
      turns: {},
    };
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
  if (turn.commandPending === true) {
    if (text(turn.pendingCommandType) === "stop") return "stopping";
    if (text(turn.pendingCommandType) === "completion") return "completing";
    return "requesting";
  }
  const state = text(turn.state).toLowerCase();
  if ([FrontendRunState.ACTION_REQUESTING, FrontendRunState.CONTINUE_REQUESTING].includes(state))
    return "requesting";
  if (state === FrontendRunState.FRONTEND_COMPLETION_REQUESTING) return "completing";
  if (state === FrontendRunState.USER_STOPPING) return "stopping";
  if (
    [
      FrontendRunState.PROCESSING,
      BackendChannelState.SENDING,
      BackendChannelState.RECONNECTING,
      BackendChannelState.INTERACTION_PENDING,
    ].includes(state)
  )
    return "sending";
  return "send";
}

export function resolveSessionTurnRuntime(registry, sessionId, turnScopeId = "") {
  const bucket = registry?.sessions?.[canonicalSessionId(registry, sessionId)];
  const latestTurn =
    !turnScopeId && !bucket?.activeTurnScopeId
      ? Object.values(bucket?.turns || {})
          .filter((turn) => Boolean(turn?.state || turn?.terminal || turn?.commandPending))
          .sort((left, right) => {
            const sequenceDelta =
              Number(right?.lifecycleSeq || right?.seq || 0) -
              Number(left?.lifecycleSeq || left?.seq || 0);
            if (sequenceDelta) return sequenceDelta;
            return (
              Number(right?.updatedAtMs || right?.finishedAtMs || 0) -
              Number(left?.updatedAtMs || left?.finishedAtMs || 0)
            );
          })[0]
      : null;
  const scope =
    turnKey(turnScopeId) || turnKey(bucket?.activeTurnScopeId) || turnKey(latestTurn?.turnScopeId);
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
    parentSessionId: text(turn?.parentSessionId),
    turnScopeId: text(turn?.turnScopeId),
    dialogProcessId: text(turn?.dialogProcessId),
    action: text(turn?.action),
    commandId: text(turn?.commandId),
    lifecycleEventType: text(turn?.lifecycleEventType),
    lifecycleObserved: turn?.lifecycleObserved === true,
    commandPending: turn?.commandPending === true,
    pendingCommandId: text(turn?.pendingCommandId),
    pendingCommandType: text(turn?.pendingCommandType),
    transportState: text(turn?.transportState),
    reconnecting: turn?.reconnecting === true,
    lastTransportError: text(turn?.lastTransportError),
    displayState,
    sending: ["requesting", "sending", "completing", "stopping"].includes(displayState),
    canStop: displayState === "sending" && turn?.canStop === true,
    terminal: turn?.terminal || null,
  };
}

export function selectTurnMessageRuntime(
  registry,
  { sessionId = "", turnScopeId = "", dialogProcessId = "" } = {},
) {
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
    lifecycleObserved: false,
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
    ? resolveTurnRuntimeByScope(registry, normalizedTurnScopeId, {
        sessionId: normalizedSessionId || routeSessionId,
      })
    : null;
  if (!turn) {
    const turnInAnotherSession =
      normalizedSessionId && normalizedTurnScopeId
        ? resolveTurnRuntimeByScope(registry, normalizedTurnScopeId)
        : null;
    return turnInAnotherSession ? null : defaultRuntimeView;
  }
  if (normalizedSessionId && turn.sessionId !== normalizedSessionId) return null;
  const state =
    turn.state === BackendChannelState.SENDING ? FrontendRunState.PROCESSING : turn.state || "";
  return {
    state,
    backendState: turn.backendState || "",
    sessionId: turn.sessionId,
    parentSessionId: turn.parentSessionId || "",
    turnScopeId: turn.turnScopeId,
    dialogProcessId: turn.dialogProcessId || "",
    source: turn.source || "",
    sourceEvent: turn.sourceEvent || "",
    lifecycleObserved: turn.lifecycleObserved === true,
    authority: turn.authority || "none",
    seq: Number(turn.seq || 0),
    updatedAt: turn.updatedAt || "",
    updatedAtMs: Number(turn.updatedAtMs || 0),
    terminal: turn.terminal || null,
    running:
      !turn.finishedAt &&
      !turn.terminal &&
      (turn.commandPending === true ||
        [
          FrontendRunState.ACTION_REQUESTING,
          FrontendRunState.PROCESSING,
          FrontendRunState.FRONTEND_COMPLETION_REQUESTING,
          FrontendRunState.USER_STOPPING,
          BackendChannelState.SENDING,
          BackendChannelState.RECONNECTING,
          BackendChannelState.INTERACTION_PENDING,
        ].includes(turn.state)),
    startedAt: turn.startedAt || turn.thinkingStartedAt || "",
    finishedAt: turn.finishedAt || turn.thinkingFinishedAt || "",
  };
}

export function resolveLatestStoppedTurn(registry, sessionId) {
  const bucket = registry?.sessions?.[text(sessionId)];
  return (
    Object.values(bucket?.turns || {})
      .filter((turn) => turn.terminal === "user_stopped")
      .sort(
        (a, b) =>
          Number(b.finishedAtMs || b.updatedAtMs || 0) -
          Number(a.finishedAtMs || a.updatedAtMs || 0),
      )[0] || null
  );
}

export function resolveLatestContinuableStoppedTurn(registry, sessionId) {
  const id = canonicalSessionId(registry, sessionId) || text(sessionId);
  const bucket = registry?.sessions?.[id];
  const consumedScopes = new Set(
    Object.values(bucket?.turns || {})
      .map((turn) => turn?.continuationSource?.turnScopeId)
      .filter(Boolean)
      .map(turnKey),
  );
  return (
    Object.values(bucket?.turns || {})
      .filter((turn) => turn.terminal === "user_stopped")
      .filter(
        (turn) => !turn.continuedByTurnScopeId && !consumedScopes.has(turnKey(turn.turnScopeId)),
      )
      .sort((left, right) => {
        const sequenceDelta =
          Number(right.lifecycleSeq || right.seq || 0) - Number(left.lifecycleSeq || left.seq || 0);
        if (sequenceDelta) return sequenceDelta;
        return (
          Number(right.finishedAtMs || right.updatedAtMs || 0) -
          Number(left.finishedAtMs || left.updatedAtMs || 0)
        );
      })[0] || null
  );
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
  const scopes = [
    ...new Set(
      (Array.isArray(turnScopeIds) ? turnScopeIds : [turnScopeIds]).map(turnKey).filter(Boolean),
    ),
  ];
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
    if (route?.sessionId === id && route?.turnScopeId === turn.turnScopeId)
      delete registry.routeIndex[turn.dialogProcessId];
  }
  delete registry.sessions[id];
  delete registry.deletedTurnScopeIdsBySession?.[id];
  return true;
}

export function pruneTerminalTurns(
  registry,
  {
    sessionId,
    referencedTurnScopeIds = [],
    retainCount = DEFAULT_TERMINAL_RETAIN_PER_SESSION,
    maxAgeMs = DEFAULT_TERMINAL_MAX_AGE_MS,
    nowMs = Date.now(),
  } = {},
) {
  const id = text(sessionId);
  const bucket = registry?.sessions?.[id];
  if (!bucket) return { removedTurnScopeIds: [] };
  const referenced = new Set(Array.from(referencedTurnScopeIds || [], turnKey).filter(Boolean));
  const selectedScope = text(resolveSessionTurnRuntime(registry, id)?.turnScopeId);
  const latestStoppedScope = text(resolveLatestContinuableStoppedTurn(registry, id)?.turnScopeId);
  const terminalTurns = Object.values(bucket.turns || {})
    .filter((turn) => Boolean(turn.terminal))
    .sort(
      (a, b) =>
        Number(b.finishedAtMs || b.updatedAtMs || 0) - Number(a.finishedAtMs || a.updatedAtMs || 0),
    );
  const removedTurnScopeIds = [];
  let retainedUnprotectedCount = 0;
  for (const turn of terminalTurns) {
    const scope = text(turn.turnScopeId);
    if (scope === selectedScope || scope === latestStoppedScope || referenced.has(scope)) continue;
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

function resolveTurnRuntimeConflict({
  current,
  sessionId,
  event,
  route,
  turnScopeId,
  ignoresDialogRoute,
}) {
  if (!sessionId) return "missing_session_identity";
  if (current?.sessionId && current.sessionId !== sessionId) return "session_identity_conflict";
  if (
    !ignoresDialogRoute &&
    current?.dialogProcessId &&
    event.dialogProcessId &&
    current.dialogProcessId !== event.dialogProcessId
  ) {
    return "dialog_process_identity_conflict";
  }
  if (
    !ignoresDialogRoute &&
    route &&
    (route.turnScopeId !== turnScopeId || route.sessionId !== sessionId)
  ) {
    return "dialog_process_identity_conflict";
  }
  return "";
}

export function applyTurnRuntimeEvent(registry, rawEvent = {}) {
  const next = registry || createTurnRuntimeRegistryState();
  if (!next.sessions) next.sessions = {};
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
    ...values,
  });
  if (!turnScopeId)
    return observation({ turn: null, applied: false, reason: "missing_turn_identity" });
  const rawRequestedSessionId = text(event.sessionId || route?.sessionId);
  const requestedSessionId = canonicalSessionId(next, rawRequestedSessionId);
  if (isTurnRuntimeDeleted(next, { sessionId: requestedSessionId, turnScopeId })) {
    return observation({
      turn: null,
      canonicalSessionId: requestedSessionId,
      applied: false,
      reason: "deleted_turn_tombstoned",
    });
  }
  const current = findTurnByScope(next, turnScopeId, { sessionId: requestedSessionId });
  const sessionId = text(requestedSessionId || current?.sessionId);
  const ignoresDialogRoute = event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED;
  const result = (values = {}) => observation({ canonicalSessionId: sessionId, ...values });
  const conflictReason = resolveTurnRuntimeConflict({
    current,
    sessionId,
    event,
    route,
    turnScopeId,
    ignoresDialogRoute,
  });
  if (conflictReason) return result({ turn: current, applied: false, reason: conflictReason });
  const activeTurnScopeId = text(
    next?.sessions?.[canonicalSessionId(next, sessionId)]?.activeTurnScopeId,
  );
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
    parentSessionId: text(rawEvent?.parentSessionId || current?.parentSessionId),
    turnScopeId,
    dialogProcessId: text(event.dialogProcessId || current?.dialogProcessId),
    action: transition.next.action,
    backendState,
    state: transition.next.state,
    terminal,
    canStop: transition.next.canStop === true,
    seq: transition.next.seq,
    updatedAtMs: nowMs,
    updatedAt: text(event.updatedAt || current?.updatedAt),
    source: text(event.source || current?.source),
    sourceEvent: text(event.sourceEvent || event.type || current?.sourceEvent),
    authority: text(event.authority || current?.authority || "none"),
    finishedAtMs: terminal ? Number(current?.finishedAtMs || nowMs) : 0,
    startedAt: text(
      event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED
        ? rawEvent?.thinkingStartedAt || rawEvent?.startedAt || current?.startedAt
        : rawEvent?.canonicalTimingObserved === true
          ? rawEvent?.thinkingStartedAt || rawEvent?.startedAt || current?.startedAt
          : current?.startedAt ||
            rawEvent?.thinkingStartedAt ||
            rawEvent?.startedAt ||
            (!current ? event.updatedAt || event.timestamp : ""),
    ),
    finishedAt: terminal
      ? text(
          event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED
            ? rawEvent?.thinkingFinishedAt ||
                rawEvent?.finishedAt ||
                current?.finishedAt ||
                event.updatedAt
            : current?.finishedAt ||
                rawEvent?.thinkingFinishedAt ||
                rawEvent?.finishedAt ||
                event.updatedAt,
        )
      : text(current?.finishedAt),
    error:
      terminal === "error"
        ? text(rawEvent?.error?.message || rawEvent?.error || rawEvent?.reason)
        : null,
    continuationSource: event.continuationSource || current?.continuationSource || null,
    continuedByTurnScopeId: text(event.continuedByTurnScopeId || current?.continuedByTurnScopeId),
  };
  const bucket = ensureSessionBucket(next, sessionId);
  const continuationSourceScope = turnKey(turn.continuationSource?.turnScopeId);
  if (continuationSourceScope && continuationSourceScope !== turnScopeId) {
    const sourceTurn = bucket.turns[continuationSourceScope];
    if (sourceTurn && sourceTurn.terminal === "user_stopped") {
      sourceTurn.continuedByTurnScopeId = turnScopeId;
    }
  }
  bucket.turns[turnScopeId] = turn;
  if (!terminal) {
    bucket.activeTurnScopeId = turnScopeId;
  } else if (turnKey(bucket.activeTurnScopeId) === turnScopeId) {
    bucket.activeTurnScopeId = "";
  }
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
  const existing = resolveTurnRuntimeByScope(registry, envelope.turnScopeId, {
    sessionId: envelope.sessionId,
  });
  const incomingRevision = Number(envelope.revision || 0);
  const incomingSequence = Number(envelope.sequence || 0);
  const currentRevision = Number(existing?.revision || 0);
  const currentSequence = Number(existing?.lifecycleSeq || 0);
  const fingerprint = executionFingerprint(envelope);
  if (existing && incomingRevision === currentRevision && incomingSequence === currentSequence) {
    if (
      text(existing.authoritativeEventId) === text(envelope.eventId) &&
      existing.authoritativeEventFingerprint === fingerprint
    ) {
      return {
        registry,
        turn: existing,
        applied: false,
        deduplicated: true,
        reason: "duplicate_authoritative_event",
      };
    }
    return {
      registry,
      turn: existing,
      applied: false,
      reason: "authoritative_event_coordinate_conflict",
    };
  }
  if (existing && (incomingRevision <= currentRevision || incomingSequence <= currentSequence)) {
    return { registry, turn: existing, applied: false, reason: "stale_authoritative_event" };
  }
  if (
    existing &&
    isFinalTurnState(existing.state, existing) &&
    !projectAuthoritativeTurnTerminal(envelope.state)
  ) {
    return { registry, turn: existing, applied: false, reason: "terminal_locked" };
  }
  const result = applyTurnRuntimeEvent(registry, {
    ...envelope,
    type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
    seq: Number(envelope?.sequence || 0),
    source: "turn_lifecycle",
  });
  if (result.applied) {
    // Keep envelope identity and lifecycle metadata in the same canonical
    // Turn projection used by snapshot hydration. These are business
    // identity fields, not a snapshot-specific observation flag.
    if (result.turn) {
      Object.assign(result.turn, {
        parentSessionId: text(envelope.parentSessionId),
        messageId: text(envelope.messageId),
        presentationMessageId: text(envelope.presentationMessageId),
        phase: text(envelope.phase || envelope.failure?.phase),
        authoritativeEventId: text(envelope.eventId),
        authoritativeEventFingerprint: fingerprint,
      });
    }
    const bucket = ensureSessionBucket(registry, envelope.sessionId);
    bucket.authoritativeSequence = Math.max(
      Number(bucket.authoritativeSequence || 0),
      Number(envelope.sequence || 0),
    );
    bucket.protocolVersion = Number(envelope.protocolVersion || 1);
    applyExecutionProjection(registry, envelope);
  }
  return result;
}

export function applyTurnTerminalResolution(registry, response = {}) {
  const validation = validateTurnTerminalResolution(response);
  if (!validation.valid || response.resolved !== true) {
    return {
      registry,
      applied: false,
      reason: response.resolved === false ? "terminal_unresolved" : "invalid_terminal_resolution",
      errors: validation.errors,
    };
  }
  const turn = response.turn || {};
  return applyTurnRuntimeEvent(registry, {
    ...turn,
    type: SESSION_RUN_EVENT.TERMINAL_RESOLVED,
    authoritativeTurnState: turn.state,
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
  if (!validation.valid)
    return { applied: false, reason: "invalid_authoritative_snapshot", errors: validation.errors };
  const sessionId = text(snapshot.sessionId);
  const sequence = Number(snapshot.sequence || 0);
  if (!sessionId || !Number.isInteger(sequence) || sequence < 0)
    return { applied: false, reason: "invalid_snapshot_identity" };
  let bucket = ensureSessionBucket(registry, sessionId);
  if (Number(bucket.authoritativeSequence || 0) > sequence)
    return { applied: false, reason: "stale_snapshot" };
  const fingerprint = JSON.stringify(snapshot);
  if (
    Number(bucket.authoritativeSequence || 0) === sequence &&
    bucket.authoritativeSnapshotFingerprint
  ) {
    if (bucket.authoritativeSnapshotFingerprint === fingerprint)
      return { applied: false, deduplicated: true, reason: "duplicate_snapshot" };
    return { applied: false, reason: "snapshot_sequence_conflict" };
  }
  const turns = [
    snapshot.activeTurn,
    ...(Array.isArray(snapshot.recentTerminalTurns) ? snapshot.recentTerminalTurns : []),
  ].filter(Boolean);
  for (const source of turns) {
    const turnScopeId = turnKey(source.turnScopeId);
    const revision = Number(source.revision || 0);
    if (
      !turnScopeId ||
      !Number.isInteger(revision) ||
      revision < 1 ||
      Number(source.sequence || 0) > sequence
    ) {
      return { applied: false, reason: "invalid_snapshot_turn" };
    }
    if (isTurnRuntimeDeleted(registry, { sessionId, turnScopeId })) continue;
    const current = bucket.turns[turnScopeId];
    if (current && Number(current.revision || 0) > revision) continue;
    if (
      current?.dialogProcessId &&
      source.dialogProcessId &&
      text(current.dialogProcessId) !== text(source.dialogProcessId)
    ) {
      return { applied: false, reason: "dialog_process_identity_conflict" };
    }
    const eventType = SNAPSHOT_STATE_EVENT[text(source.state)];
    if (!eventType) return { applied: false, reason: "invalid_snapshot_state" };
    const sourceIsTerminal = isAuthoritativeTerminalState(source.state);
    const phase = text(source.phase || source.failure?.phase);
    const state = projectAuthoritativeTurnState(source.state);
    if (current && isFinalTurnState(current.state, current) && !isFinalTurnState(state, source))
      continue;
    const terminal = projectAuthoritativeTurnTerminal(source.state);
    const preservesTerminalResolution =
      sourceIsTerminal &&
      current?.terminalResolved === true &&
      Number(current?.revision || 0) >= revision;
    const action = text(source.action || current?.action || "send");
    const commandId = text(source.commandId || current?.commandId);
    const startedAt = text(
      source.startedAt || source.thinkingStartedAt || source.updatedAt || current?.startedAt,
    );
    const updatedAt = text(source.updatedAt || current?.updatedAt);
    const turn = {
      ...(current || {}),
      sessionId,
      turnScopeId,
      dialogProcessId: text(source.dialogProcessId),
      state,
      phase,
      revision,
      seq: Number(source.sequence || 0),
      lifecycleSeq: Number(source.sequence || 0),
      backendState: text(source.executionState),
      canStop: source.capabilities?.canStop === true,
      terminal,
      action,
      commandId,
      messageId: text(source.messageId),
      presentationMessageId: text(source.presentationMessageId),
      failure: source.failure || null,
      lifecycleEventType:
        SNAPSHOT_STATE_EVENT[text(source.state)] || text(current?.lifecycleEventType),
      authoritativeCompletionCommit: sourceIsTerminal
        ? {
            completionCommitId: text(source.completionCommitId),
            summaryVersion: Number(source.summaryVersion || 0),
            revision,
          }
        : current?.authoritativeCompletionCommit || null,
      terminalResolved:
        preservesTerminalResolution || (!sourceIsTerminal && current?.terminalResolved === true),
      startedAt,
      finishedAt: text(source.finishedAt || current?.finishedAt),
      finishedAtMs: sourceIsTerminal
        ? Number(Date.parse(source.finishedAt || source.updatedAt) || current?.finishedAtMs || 0)
        : Number(current?.finishedAtMs || 0),
      updatedAt,
      updatedAtMs: updatedAt ? Date.parse(updatedAt) || 0 : Number(current?.updatedAtMs || 0),
      error: null,
      finalizeIntent: source.finalizeIntent || current?.finalizeIntent || null,
      continuationSource: source.continuationSource || current?.continuationSource || null,
      continuedByTurnScopeId: text(
        source.continuedByTurnScopeId || current?.continuedByTurnScopeId,
      ),
      commandPending: false,
      pendingCommandId: "",
      pendingCommandType: "",
      transportSeq: 0,
      terminalMaterialization: current?.terminalMaterialization || null,
      parentSessionId: text(source.parentSessionId),
      source: "turn_lifecycle",
      sourceEvent: "backend_turn_lifecycle",
      authority: "none",
      lifecycleObserved: true,
    };
    bucket.turns[turnScopeId] = turn;
    if (turn.dialogProcessId)
      registry.routeIndex[turn.dialogProcessId] = { sessionId, turnScopeId };
  }
  const replacedTurnScopeIds = [
    ...new Set(
      snapshot.replacedTurns
        .map((replacement) => turnKey(replacement?.turnScopeId))
        .filter(Boolean),
    ),
  ];
  const replacementDeletion = confirmTurnRuntimeDeletion(registry, replacedTurnScopeIds, {
    sessionId,
  });
  bucket = ensureSessionBucket(registry, sessionId);
  const previousActiveTurnScopeId = text(bucket.activeTurnScopeId);
  const candidateSnapshotActiveScope = turnKey(snapshot.activeTurnScopeId);
  const snapshotActiveScope = isTurnRuntimeDeleted(registry, {
    sessionId,
    turnScopeId: candidateSnapshotActiveScope,
  })
    ? ""
    : candidateSnapshotActiveScope;
  const snapshotActiveState = text(snapshot.activeTurn?.state);
  const snapshotActiveIsTerminal = isAuthoritativeTerminalState(snapshotActiveState);
  bucket.activeTurnScopeId = snapshotActiveIsTerminal ? "" : snapshotActiveScope;
  if (!bucket.activeTurnScopeId && previousActiveTurnScopeId) {
    const previous = bucket.turns[previousActiveTurnScopeId];
    if (previous?.dialogProcessId) delete registry.routeIndex[previous.dialogProcessId];
  }
  bucket.authoritativeSequence = sequence;
  bucket.protocolVersion = Number(snapshot.protocolVersion || 1);
  bucket.authoritativeSnapshotFingerprint = fingerprint;
  return { applied: true, bucket, replacedTurnScopeIds, replacementDeletion };
}

export function applyTurnTimingUpdate(registry, update = {}) {
  const sessionId = text(update?.sessionId);
  const turnScopeId = turnKey(update?.turnScopeId);
  const dialogProcessId = text(update?.dialogProcessId);
  const startedAt = text(update?.thinkingStartedAt || update?.startedAt);
  const finishedAt = text(update?.thinkingFinishedAt || update?.finishedAt);
  if (!sessionId || !turnScopeId) return { applied: false, reason: "missing_timing_identity" };
  if (!startedAt && !finishedAt) return { applied: false, reason: "missing_timing_value" };
  if (isTurnRuntimeDeleted(registry, { sessionId, turnScopeId })) {
    return { applied: false, reason: "turn_runtime_deleted" };
  }
  const bucket = ensureSessionBucket(registry, sessionId);
  const current = bucket.turns[turnScopeId] || {};
  if (
    current?.dialogProcessId &&
    dialogProcessId &&
    text(current.dialogProcessId) !== dialogProcessId
  ) {
    return { applied: false, reason: "dialog_process_identity_conflict" };
  }
  const nextStartedAt = text(current.startedAt || startedAt);
  const nextFinishedAt = text(current.finishedAt || finishedAt);
  const nextDialogProcessId = text(current.dialogProcessId || dialogProcessId);
  const canonicalTimingObserved =
    update.canonical === true || current.canonicalTimingObserved === true;
  if (
    text(current.startedAt) === nextStartedAt &&
    text(current.finishedAt) === nextFinishedAt &&
    text(current.dialogProcessId) === nextDialogProcessId &&
    current.canonicalTimingObserved === canonicalTimingObserved
  ) {
    return { applied: false, deduplicated: true, reason: "timing_unchanged", turn: current };
  }
  const turn = {
    ...current,
    sessionId,
    turnScopeId,
    dialogProcessId: nextDialogProcessId,
    startedAt: nextStartedAt,
    finishedAt: nextFinishedAt,
    startedAtMs: nextStartedAt ? Date.parse(nextStartedAt) || 0 : Number(current.startedAtMs || 0),
    finishedAtMs: nextFinishedAt
      ? Date.parse(nextFinishedAt) || 0
      : Number(current.finishedAtMs || 0),
    canonicalTimingObserved,
    timingSource: text(update?.source || current.timingSource || "turn_runtime_event"),
  };
  bucket.turns[turnScopeId] = turn;
  if (nextDialogProcessId) registry.routeIndex[nextDialogProcessId] = { sessionId, turnScopeId };
  return { applied: true, bucket, turn };
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
    const result = applyTurnTimingUpdate(registry, {
      sessionId,
      turnScopeId: timing.turnScopeId,
      dialogProcessId: timing.dialogProcessId,
      startedAt: timing.startedAt,
      finishedAt: timing.finishedAt,
      canonical: true,
      source: "session_turn_timing_snapshot",
    });
    if (result.reason === "dialog_process_identity_conflict") return result;
    if (result.applied) hydratedTurnScopeIds.push(timing.turnScopeId);
  }
  return hydratedTurnScopeIds.length
    ? { applied: true, bucket, hydratedTurnScopeIds }
    : { applied: false, deduplicated: true, reason: "timing_snapshot_unchanged" };
}
