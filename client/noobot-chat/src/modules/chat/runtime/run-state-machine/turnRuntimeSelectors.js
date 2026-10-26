/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";
import {
  requireCanonicalTurnScopeId,
  requireOptionalCanonicalTurnScopeId,
} from "@noobot/session-protocol/turn-scope-identity";
import { AGENT_CHANNEL_STATE, FrontendRunState, STATUS_STEP_STAGE } from "./constants.js";
import { isStageStatusStepState, resolvePendingCommandStatusStep } from "./statusStep.js";
import { findTurnByScope, resolveTurnRoute } from "./turnRuntimeRegistryIdentity.js";

export function turnRuntimeDisplayState(turn = null) {
  if (!turn || turn.terminal) return "";
  if (turn.commandPending === true)
    return resolvePendingCommandStatusStep(turn.pendingCommandType) || STATUS_STEP_STAGE.REQUESTING;
  const state = text(turn.state).toLowerCase();
  if ([FrontendRunState.ACTION_REQUESTING, FrontendRunState.CONTINUE_REQUESTING].includes(state)) {
    return STATUS_STEP_STAGE.REQUESTING;
  }
  if (state === FrontendRunState.FRONTEND_COMPLETION_REQUESTING)
    return STATUS_STEP_STAGE.COMPLETING;
  if (state === FrontendRunState.USER_STOPPING) return STATUS_STEP_STAGE.STOPPING;
  if (
    [
      FrontendRunState.PROCESSING,
      AGENT_CHANNEL_STATE.SENDING,
      AGENT_CHANNEL_STATE.RECONNECTING,
      AGENT_CHANNEL_STATE.INTERACTION_PENDING,
    ].includes(state)
  ) {
    return STATUS_STEP_STAGE.SENDING;
  }
  return "";
}

export function selectSessionRuntimeBucket(registry, sessionId) {
  return registry.sessions[text(sessionId)] || null;
}

function latestObservedTurn(bucket) {
  return Object.values(bucket.turns)
    .filter((turn) => Boolean(turn?.state || turn?.terminal || turn?.commandPending))
    .sort((left, right) => {
      const sequenceDelta = Number(right?.lifecycleSeq || 0) - Number(left?.lifecycleSeq || 0);
      if (sequenceDelta) return sequenceDelta;
      return (
        Number(right?.updatedAtMs || right?.finishedAtMs || 0) -
        Number(left?.updatedAtMs || left?.finishedAtMs || 0)
      );
    })[0];
}

export function selectCurrentTurnRuntime(registry, sessionId) {
  const bucket = selectSessionRuntimeBucket(registry, sessionId);
  if (!bucket) return null;
  if (bucket.activeTurnScopeId) return bucket.turns[bucket.activeTurnScopeId] ?? null;
  return latestObservedTurn(bucket) ?? null;
}

export function selectTurnRuntimeByScope(registry, sessionId, turnScopeId) {
  const scope = requireCanonicalTurnScopeId(turnScopeId);
  return selectSessionRuntimeBucket(registry, sessionId)?.turns[scope] ?? null;
}

export function resolveTurnRuntimeByScope(registry, turnScopeId, { sessionId = "" } = {}) {
  const scope = requireOptionalCanonicalTurnScopeId(turnScopeId);
  const id = text(sessionId);
  if (!scope) return null;
  return findTurnByScope(registry, scope, { sessionId: id });
}

export function selectSessionTurnRuntime(registry, sessionId) {
  return projectTurnRuntimeView(sessionId, selectCurrentTurnRuntime(registry, sessionId));
}

export function projectTurnRuntimeView(sessionId, turn) {
  const normalizedSessionId = text(sessionId);
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
    sending: isStageStatusStepState(displayState),
    canStop: displayState === STATUS_STEP_STAGE.SENDING && turn?.canStop === true,
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
    displayState: "",
    sessionId: normalizedSessionId,
    turnScopeId: requireOptionalCanonicalTurnScopeId(turnScopeId),
    dialogProcessId: normalizedDialogProcessId,
    source: "",
    sourceEvent: "",
    lifecycleObserved: false,
    updatedAt: "",
    updatedAtMs: 0,
    terminal: null,
    running: false,
    startedAt: "",
    finishedAt: "",
    thinkingFinishedAt: "",
    modelLoopRound: 0,
  };
  let normalizedTurnScopeId = requireOptionalCanonicalTurnScopeId(turnScopeId);
  let routeSessionId = "";
  if (!normalizedTurnScopeId && normalizedDialogProcessId) {
    const route = resolveTurnRoute(registry, normalizedDialogProcessId);
    normalizedTurnScopeId = route?.turnScopeId || "";
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
    turn.state === AGENT_CHANNEL_STATE.SENDING ? FrontendRunState.PROCESSING : turn.state || "";
  return {
    state,
    backendState: turn.backendState || "",
    displayState: turnRuntimeDisplayState(turn),
    sessionId: turn.sessionId,
    parentSessionId: turn.parentSessionId || "",
    turnScopeId: turn.turnScopeId,
    dialogProcessId: turn.dialogProcessId || "",
    source: turn.source || "",
    sourceEvent: turn.sourceEvent || "",
    lifecycleObserved: turn.lifecycleObserved === true,
    authority: turn.authority || "none",
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
          AGENT_CHANNEL_STATE.SENDING,
          AGENT_CHANNEL_STATE.RECONNECTING,
          AGENT_CHANNEL_STATE.INTERACTION_PENDING,
        ].includes(turn.state)),
    startedAt: text(turn.startedAt),
    finishedAt: text(turn.finishedAt),
    thinkingFinishedAt: text(turn.timing?.thinkingFinishedAt),
    modelLoopRound: turn.timing?.modelLoopRound ?? 0,
  };
}

export function resolveLatestStoppedTurn(registry, sessionId) {
  const bucket = registry?.sessions?.[text(sessionId)];
  return (
    Object.values(bucket?.turns || {})
      .filter((turn) => turn.terminal === "user_stopped")
      .sort(
        (left, right) =>
          Number(right.finishedAtMs || right.updatedAtMs || 0) -
          Number(left.finishedAtMs || left.updatedAtMs || 0),
      )[0] || null
  );
}

export function resolveLatestContinuableStoppedTurn(registry, sessionId) {
  const id = text(sessionId);
  const bucket = registry?.sessions?.[id];
  const consumedScopes = new Set(
    Object.values(bucket?.turns || {})
      .map((turn) => turn?.continuationSource?.turnScopeId)
      .filter(Boolean),
  );
  return (
    Object.values(bucket?.turns || {})
      .filter((turn) => turn.terminal === "user_stopped")
      .filter((turn) => !turn.continuedByTurnScopeId && !consumedScopes.has(turn.turnScopeId))
      .sort((left, right) => {
        const sequenceDelta = Number(right.lifecycleSeq || 0) - Number(left.lifecycleSeq || 0);
        if (sequenceDelta) return sequenceDelta;
        return (
          Number(right.finishedAtMs || right.updatedAtMs || 0) -
          Number(left.finishedAtMs || left.updatedAtMs || 0)
        );
      })[0] || null
  );
}
