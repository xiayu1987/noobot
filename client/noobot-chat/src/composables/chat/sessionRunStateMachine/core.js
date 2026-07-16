/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { FrontendRunState, SESSION_RUN_EVENT } from "./constants";
import { evaluateSessionRunState } from "./evaluation";
import { normalizeSessionRunEvent } from "./eventNormalization";
import { transitionPriority, transitionRule } from "./normalize";
import { shouldStartNewTurn } from "./runIdentity";
import { logStopButtonEvaluation } from "../debug/stopContinueDebugLogger";
import { createInitialSessionRunState } from "./stateSnapshot";
import { canApplyNormalizedEvent, resolveNormalizedTransitionDecision } from "./transitionDecision";

export function normalizeTransitionInputs(currentState = createInitialSessionRunState(), rawEvent = {}) {
  const current = currentState || createInitialSessionRunState();
  const event = normalizeSessionRunEvent(classifyFailureEvent(current, rawEvent));
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

function classifyFailureEvent(current = {}, rawEvent = {}) {
  if (rawEvent?.type !== SESSION_RUN_EVENT.LOCAL_FAILURE || rawEvent?.failureState) return rawEvent;
  const state = current?.state;
  const failureState = state === "frontend_completion_requesting"
    ? "frontend_completion_error"
    : state === "frontend_user_stopping"
      ? "frontend_stop_error"
      : state === "frontend_action_requesting"
        ? "frontend_action_request_error"
        : ["sending", "continue_requesting", "resend_replacing_turn", "resend_streaming", "completed", "interaction_pending", "reconnecting"].includes(state)
        ? "frontend_processing_error"
        : "frontend_action_request_error";
  return { ...rawEvent, failureState };
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

export function transitionSessionRunState(currentState = createInitialSessionRunState(), rawEvent = {}) {
  const current = currentState || createInitialSessionRunState();
  const event = normalizeSessionRunEvent(classifyFailureEvent(current, rawEvent));
  if (event.type === SESSION_RUN_EVENT.LOCAL_RESET || event.type === SESSION_RUN_EVENT.LOCAL_FAILURE || [
    SESSION_RUN_EVENT.LOCAL_RESEND_COMPLETED,
    SESSION_RUN_EVENT.LOCAL_RESEND_FAILED,
    SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED,
    SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_FAILED,
    SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_APPLIED,
    SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_FAILED,
  ].includes(event.type)) {
    return createInitialSessionRunState({ updatedAt: event.timestamp, updatedAtMs: event.timestamp, lastEventType: event.type });
  }
  let state = current.state || FrontendRunState.IDLE;
  if ([
    SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
    SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
    SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_STARTED,
    SESSION_RUN_EVENT.LOCAL_RESEND_STARTED,
    SESSION_RUN_EVENT.LOCAL_RESEND_REPLACING_TURN,
    SESSION_RUN_EVENT.LOCAL_RESEND_STREAMING,
  ].includes(event.type)) state = FrontendRunState.ACTION_REQUESTING;
  if (event.type === SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_REQUEST_STARTED) {
    state = FrontendRunState.FRONTEND_COMPLETION_REQUESTING;
  }
  if ([
    SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
    SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
  ].includes(event.type) && [
    "sending",
    "reconnecting",
    "interaction_pending",
  ].includes(event.state)) {
    state = FrontendRunState.PROCESSING;
  }
  if ([
    SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUESTED,
    SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED,
    SESSION_RUN_EVENT.LOCAL_USER_STOP_PENDING_BACKEND_READY,
  ].includes(event.type)) state = FrontendRunState.USER_STOPPING;
  // Backend/reconnect in-flight facts also restore the temporary processing
  // lock. Persisted turn results remain owned by the session summary.
  return {
    ...createInitialSessionRunState(),
    state,
    source: event.source,
    sourceEvent: event.sourceEvent,
    updatedAt: event.timestamp,
    updatedAtMs: event.timestamp,
    updatedAtIso: event.updatedAt || "",
    lastEventType: event.type,
  };
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
  logStopButtonEvaluation({ previousState, nextState, event, evaluation, changed: previousState !== nextState });
  return { previousState, nextState, evaluation, changed: previousState !== nextState };
}

export function applySessionRunStateEvents({ stateRef, sending, canStop, events = [] } = {}) {
  const previousState = stateRef?.value || createInitialSessionRunState();
  const nextState = reduceSessionRunEvents(previousState, events);
  if (stateRef) stateRef.value = nextState;
  const evaluation = evaluateSessionRunState(nextState);
  if (sending) sending.value = evaluation.sending;
  if (canStop) canStop.value = evaluation.canStop;
  logStopButtonEvaluation({ previousState, nextState, event: { type: "batch", count: Array.isArray(events) ? events.length : 0 }, evaluation, changed: previousState !== nextState });
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
