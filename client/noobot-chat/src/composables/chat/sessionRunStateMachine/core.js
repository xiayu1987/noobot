/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_RUN_EVENT } from "./constants";
import { evaluateSessionRunState } from "./evaluation";
import { normalizeSessionRunEvent } from "./eventNormalization";
import { transitionPriority, transitionRule, trim } from "./normalize";
import { resolveRunTurnScopeId, shouldStartNewTurn } from "./runIdentity";
import { createInitialSessionRunState, applySessionRunEventPatch } from "./stateSnapshot";
import { canApplyNormalizedEvent, resolveNormalizedTransitionDecision } from "./transitionDecision";

export function normalizeTransitionInputs(currentState = createInitialSessionRunState(), rawEvent = {}) {
  const current = currentState || createInitialSessionRunState();
  const event = normalizeSessionRunEvent(rawEvent);
  const startsNewTurn = shouldStartNewTurn(current, event);
  const currentPriority = transitionPriority(current.state);
  const nextPriority = transitionPriority(event.state);
  const currentSeq = Number(current.seq || 0);
  const eventSeq = Number(event.seq || 0);

  return {
    current,
    event,
    startsNewTurn,
    currentPriority,
    nextPriority,
    currentSeq,
    eventSeq,
    currentRule: transitionRule(current.state),
    staleSeq: eventSeq > 0 && currentSeq > 0 && eventSeq < currentSeq,
  };
}

export function canApplyEvent(currentState = createInitialSessionRunState(), rawEvent = {}) {
  return canApplyNormalizedEvent(normalizeTransitionInputs(currentState, rawEvent));
}

export function resolveTransitionDecision(currentState = createInitialSessionRunState(), rawEvent = {}) {
  return resolveNormalizedTransitionDecision(normalizeTransitionInputs(currentState, rawEvent));
}

export function resolveNextStateByTransitionTable(currentState = createInitialSessionRunState(), rawEvent = {}) {
  return resolveTransitionDecision(currentState, rawEvent).nextState;
}

function resolveNextDialogProcessId(current = {}, event = {}, { startsNewTurn = false } = {}) {
  if (startsNewTurn) return trim(event.dialogProcessId);
  return trim(event.dialogProcessId) || trim(current.dialogProcessId);
}

function resolveNextTurnScopeId(current = {}, event = {}, { startsNewTurn = false } = {}) {
  if (startsNewTurn) return resolveRunTurnScopeId(event);
  return resolveRunTurnScopeId(event) || resolveRunTurnScopeId(current);
}

export function transitionSessionRunState(currentState = createInitialSessionRunState(), rawEvent = {}) {
  const transition = normalizeTransitionInputs(currentState, rawEvent);
  const { current, event, startsNewTurn } = transition;
  if (!canApplyNormalizedEvent(transition)) return current;
  if (event.type === SESSION_RUN_EVENT.LOCAL_RESET) return createInitialSessionRunState({ updatedAt: event.timestamp });

  return applySessionRunEventPatch({
    current,
    event,
    startsNewTurn,
    nextDialogProcessId: resolveNextDialogProcessId(current, event, { startsNewTurn }),
    nextTurnScopeId: resolveNextTurnScopeId(current, event, { startsNewTurn }),
  });
}

export function reduceSessionRunEvents(initialState = createInitialSessionRunState(), rawEvents = []) {
  return (Array.isArray(rawEvents) ? rawEvents : []).reduce(
    (state, event) => transitionSessionRunState(state, event),
    initialState || createInitialSessionRunState(),
  );
}

export function applySessionRunStateEvent({ stateRef, sending, canStop, event } = {}) {
  const previousState = stateRef?.value || createInitialSessionRunState();
  const nextState = transitionSessionRunState(previousState, event);
  if (stateRef) stateRef.value = nextState;
  const evaluation = evaluateSessionRunState(nextState);
  if (sending) sending.value = evaluation.sending;
  if (canStop) canStop.value = evaluation.canStop;
  return { previousState, nextState, evaluation, changed: previousState !== nextState };
}

export function applySessionRunStateEvents({ stateRef, sending, canStop, events = [] } = {}) {
  const previousState = stateRef?.value || createInitialSessionRunState();
  const nextState = reduceSessionRunEvents(previousState, events);
  if (stateRef) stateRef.value = nextState;
  const evaluation = evaluateSessionRunState(nextState);
  if (sending) sending.value = evaluation.sending;
  if (canStop) canStop.value = evaluation.canStop;
  return { previousState, nextState, evaluation, changed: previousState !== nextState };
}

export { createInitialSessionRunState } from "./stateSnapshot";
export {
  evaluateSessionRunState,
  isInFlightSessionRunState,
  isStopLockedSessionRunState,
  isTerminalSessionRunState,
} from "./evaluation";
export { normalizeSessionRunEvent } from "./eventNormalization";
