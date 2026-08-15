/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BackendChannelState, FrontendRunState } from "./constants.js";
import {
  canonicalSessionId,
  canonicalTurnScopeId,
  findTurnByScope,
  resolveTurnRoute,
  runtimeText,
} from "./turnRuntimeRegistryIdentity.js";

export function turnRuntimeDisplayState(turn = null) {
  if (!turn) return "send";
  if (turn.terminal === "user_stopped") return "continue";
  if (turn.terminal) return "send";
  if (turn.commandPending === true) {
    if (runtimeText(turn.pendingCommandType) === "stop") return "stopping";
    if (runtimeText(turn.pendingCommandType) === "completion") return "completing";
    return "requesting";
  }
  const state = runtimeText(turn.state).toLowerCase();
  if ([FrontendRunState.ACTION_REQUESTING, FrontendRunState.CONTINUE_REQUESTING].includes(state)) {
    return "requesting";
  }
  if (state === FrontendRunState.FRONTEND_COMPLETION_REQUESTING) return "completing";
  if (state === FrontendRunState.USER_STOPPING) return "stopping";
  if (
    [
      FrontendRunState.PROCESSING,
      BackendChannelState.SENDING,
      BackendChannelState.RECONNECTING,
      BackendChannelState.INTERACTION_PENDING,
    ].includes(state)
  ) {
    return "sending";
  }
  return "send";
}

export function resolveSessionTurnRuntime(registry, sessionId, turnScopeId = "") {
  const bucket = registry?.sessions?.[canonicalSessionId(sessionId)];
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
    canonicalTurnScopeId(turnScopeId) ||
    canonicalTurnScopeId(bucket?.activeTurnScopeId) ||
    canonicalTurnScopeId(latestTurn?.turnScopeId);
  return scope ? bucket?.turns?.[scope] || null : null;
}

export function resolveTurnRuntimeByScope(registry, turnScopeId, { sessionId = "" } = {}) {
  const scope = canonicalTurnScopeId(turnScopeId);
  const id = canonicalSessionId(sessionId);
  if (!scope) return null;
  return findTurnByScope(registry, scope, { sessionId: id });
}

export function selectSessionTurnRuntime(registry, sessionId, turnScopeId = "") {
  const normalizedSessionId = runtimeText(sessionId);
  const turn = resolveSessionTurnRuntime(registry, normalizedSessionId, turnScopeId);
  const displayState = turnRuntimeDisplayState(turn);
  return {
    sessionId: normalizedSessionId,
    parentSessionId: runtimeText(turn?.parentSessionId),
    turnScopeId: runtimeText(turn?.turnScopeId),
    dialogProcessId: runtimeText(turn?.dialogProcessId),
    action: runtimeText(turn?.action),
    commandId: runtimeText(turn?.commandId),
    lifecycleEventType: runtimeText(turn?.lifecycleEventType),
    lifecycleObserved: turn?.lifecycleObserved === true,
    commandPending: turn?.commandPending === true,
    pendingCommandId: runtimeText(turn?.pendingCommandId),
    pendingCommandType: runtimeText(turn?.pendingCommandType),
    transportState: runtimeText(turn?.transportState),
    reconnecting: turn?.reconnecting === true,
    lastTransportError: runtimeText(turn?.lastTransportError),
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
  const normalizedSessionId = runtimeText(sessionId);
  const normalizedDialogProcessId = runtimeText(dialogProcessId);
  const defaultRuntimeView = {
    state: "",
    backendState: "",
    sessionId: normalizedSessionId,
    turnScopeId: canonicalTurnScopeId(turnScopeId),
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
  let normalizedTurnScopeId = canonicalTurnScopeId(turnScopeId);
  let routeSessionId = "";
  if (!normalizedTurnScopeId && normalizedDialogProcessId) {
    const route = resolveTurnRoute(registry, normalizedDialogProcessId);
    normalizedTurnScopeId = canonicalTurnScopeId(route?.turnScopeId);
    routeSessionId = runtimeText(route?.sessionId);
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
  const bucket = registry?.sessions?.[runtimeText(sessionId)];
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
  const id = canonicalSessionId(sessionId);
  const bucket = registry?.sessions?.[id];
  const consumedScopes = new Set(
    Object.values(bucket?.turns || {})
      .map((turn) => turn?.continuationSource?.turnScopeId)
      .filter(Boolean)
      .map(canonicalTurnScopeId),
  );
  return (
    Object.values(bucket?.turns || {})
      .filter((turn) => turn.terminal === "user_stopped")
      .filter(
        (turn) =>
          !turn.continuedByTurnScopeId &&
          !consumedScopes.has(canonicalTurnScopeId(turn.turnScopeId)),
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
