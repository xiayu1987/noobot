/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  COMMON_TRANSITION_GUARD_IDS,
  FrontendRunState,
  SESSION_RUN_EVENT,
  SESSION_RUN_TRANSITION_DECISION_REASON,
  SESSION_RUN_TRANSITION_GUARD_ID,
  SESSION_RUN_TRANSITION_TABLE,
} from "./constants";
import { normalizeState } from "./normalize";
import {
  hasEventState,
  isNotLeavingTerminal,
  isNotReopeningStopLock,
  isNotStaleSeqRegression,
  isPriorityForwardOrNewTurn,
  isSameConversationScopeOrNewTurn,
} from "./runIdentity";

export const SESSION_RUN_TRANSITION_GUARDS = Object.freeze([
  Object.freeze({
    id: SESSION_RUN_TRANSITION_GUARD_ID.HAS_EVENT_STATE,
    reason: SESSION_RUN_TRANSITION_DECISION_REASON.MISSING_EVENT_STATE,
    passes: ({ event = {} } = {}) => hasEventState(event),
  }),
  Object.freeze({
    id: SESSION_RUN_TRANSITION_GUARD_ID.SAME_CONVERSATION_SCOPE_OR_NEW_TURN,
    reason: SESSION_RUN_TRANSITION_DECISION_REASON.DIFFERENT_SCOPE,
    passes: isSameConversationScopeOrNewTurn,
  }),
  Object.freeze({
    id: SESSION_RUN_TRANSITION_GUARD_ID.STOP_LOCK_NOT_REOPENED,
    reason: SESSION_RUN_TRANSITION_DECISION_REASON.STOP_LOCK_REOPEN,
    passes: isNotReopeningStopLock,
  }),
  Object.freeze({
    id: SESSION_RUN_TRANSITION_GUARD_ID.TERMINAL_NOT_REOPENED,
    reason: SESSION_RUN_TRANSITION_DECISION_REASON.TERMINAL_LOCK_REOPEN,
    passes: isNotLeavingTerminal,
  }),
  Object.freeze({
    id: SESSION_RUN_TRANSITION_GUARD_ID.NO_STALE_SEQ_REGRESSION,
    reason: SESSION_RUN_TRANSITION_DECISION_REASON.STALE_SEQ_REGRESSION,
    passes: isNotStaleSeqRegression,
  }),
  Object.freeze({
    id: SESSION_RUN_TRANSITION_GUARD_ID.PRIORITY_FORWARD_OR_NEW_TURN,
    reason: SESSION_RUN_TRANSITION_DECISION_REASON.PRIORITY_REGRESSION,
    passes: isPriorityForwardOrNewTurn,
  }),
]);

export const SESSION_RUN_TRANSITION_GUARD_BY_ID = Object.freeze(Object.fromEntries(
  SESSION_RUN_TRANSITION_GUARDS.map((guard) => [guard.id, guard]),
));

export function resolveTransitionGuards(state = "") {
  return (SESSION_RUN_TRANSITION_TABLE[normalizeState(state)]?.guards || COMMON_TRANSITION_GUARD_IDS)
    .map((guardId) => SESSION_RUN_TRANSITION_GUARD_BY_ID[guardId])
    .filter(Boolean);
}

export function resolveNormalizedTransitionDecision(transition = {}) {
  const { current = {}, event = {} } = transition;
  const currentState = normalizeState(current.state) || FrontendRunState.IDLE;

  function decision(canApply, reason, nextState = currentState) {
    return { canApply, reason, nextState };
  }

  if (event.type === SESSION_RUN_EVENT.LOCAL_RESET) {
    return decision(true, SESSION_RUN_TRANSITION_DECISION_REASON.LOCAL_RESET, FrontendRunState.IDLE);
  }
  for (const guard of resolveTransitionGuards(currentState)) {
    if (!guard.passes(transition)) {
      return decision(false, guard.reason);
    }
  }
  return decision(true, SESSION_RUN_TRANSITION_DECISION_REASON.APPLIED, event.state);
}

export function canApplyNormalizedEvent(transition = {}) {
  return resolveNormalizedTransitionDecision(transition).canApply;
}
