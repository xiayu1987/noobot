/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  BackendChannelState,
  FrontendTerminalStates,
  FrontendRunState,
  SESSION_RUN_EVENT,
  SESSION_RUN_TRANSITION_RULE,
  STOP_LOCK_REOPEN_STATES,
} from "./constants";
import { normalizeState, trim } from "./normalize";

export function resolveEventScope(value = {}) {
  return trim(value.turnScopeId);
}

export function resolveEventProcessScope(value = {}) {
  return trim(value.dialogProcessId);
}

export function hasRunProcessIdentity(value = {}) {
  return Boolean(resolveEventProcessScope(value));
}

export function hasRunTurnIdentity(value = {}) {
  return Boolean(resolveEventScope(value));
}

export function hasRunIdentity(value = {}) {
  return hasRunProcessIdentity(value) || hasRunTurnIdentity(value);
}

export function hasMatchingRunTurnIdentity(current = {}, event = {}) {
  const currentTurnScopeId = trim(current.turnScopeId);
  const eventTurnScopeId = trim(event.turnScopeId);
  return Boolean(currentTurnScopeId && eventTurnScopeId && currentTurnScopeId === eventTurnScopeId);
}

export function hasConflictingRunTurnIdentity(current = {}, event = {}) {
  const currentTurnScopeId = trim(current.turnScopeId);
  const eventTurnScopeId = trim(event.turnScopeId);
  return Boolean(currentTurnScopeId && eventTurnScopeId && currentTurnScopeId !== eventTurnScopeId);
}

export function sameConversationScope(current = {}, event = {}) {
  const currentSessionId = trim(current.sessionId);
  const eventSessionId = trim(event.sessionId);
  if (currentSessionId && eventSessionId && currentSessionId !== eventSessionId) return false;
  const currentDialogProcessId = trim(current.dialogProcessId);
  const eventDialogProcessId = trim(event.dialogProcessId);
  if (currentDialogProcessId && eventDialogProcessId && currentDialogProcessId !== eventDialogProcessId) {
    return false;
  }
  if (hasConflictingRunTurnIdentity(current, event)) return false;

  const currentHasTurnIdentity = hasRunTurnIdentity(current);
  const eventHasTurnIdentity = hasRunTurnIdentity(event);
  if (currentHasTurnIdentity) {
    return hasMatchingRunTurnIdentity(current, event);
  }
  if (currentHasTurnIdentity && eventHasTurnIdentity) return false;

  const currentHasProcessIdentity = hasRunProcessIdentity(current);
  const eventHasProcessIdentity = hasRunProcessIdentity(event);
  if (
    (currentHasTurnIdentity && eventHasProcessIdentity) ||
    (currentHasProcessIdentity && eventHasTurnIdentity)
  ) {
    return false;
  }
  const processMatched = Boolean(currentDialogProcessId && eventDialogProcessId);
  const turnMatched = hasMatchingRunTurnIdentity(current, event);
  if (processMatched || turnMatched) return true;
  return true;
}

export function canBindBackendDialogProcessIdByTurnScope(current = {}, event = {}) {
  if (trim(current.dialogProcessId)) return false;
  const currentTurnScopeId = trim(current.turnScopeId);
  const eventTurnScopeId = trim(event.turnScopeId);
  return Boolean(currentTurnScopeId && eventTurnScopeId && currentTurnScopeId === eventTurnScopeId && trim(event.dialogProcessId));
}

export function resolveRunTurnScopeId(value = {}) {
  return trim(value.turnScopeId);
}

export function shouldStartNewTurn(current = {}, event = {}) {
  if (![
    SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
    SESSION_RUN_EVENT.LOCAL_RESEND_STARTED,
    SESSION_RUN_EVENT.LOCAL_RESEND_REPLACING_TURN,
  ].includes(event.type)) return false;
  if (FrontendTerminalStates.includes(normalizeState(current.state))) return true;
  const eventScope = resolveEventScope(event);
  const currentScope = resolveEventScope(current);
  if (!eventScope || !currentScope) return true;
  return eventScope !== currentScope;
}

export function hasEventState(event = {}) {
  return Boolean(event.state);
}

export function isSameConversationScopeOrNewTurn({ current = {}, event = {}, startsNewTurn = false } = {}) {
  if (isUnscopedLocalFailureForScopedTurn({ current, event, startsNewTurn })) return false;
  if (isUnscopedBackendStateForScopedTurn({ current, event, startsNewTurn })) return false;
  return sameConversationScope(current, event) || startsNewTurn || canBindBackendDialogProcessIdByTurnScope(current, event);
}

export function isNotReopeningStopLock({ event = {}, startsNewTurn = false, currentRule = "" } = {}) {
  if (currentRule !== SESSION_RUN_TRANSITION_RULE.STOP_LOCKED) return true;
  if (startsNewTurn) return true;
  return !STOP_LOCK_REOPEN_STATES.includes(event.state);
}

export function isNotLeavingTerminal({ event = {}, startsNewTurn = false, currentRule = "" } = {}) {
  if (currentRule !== SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED) return true;
  if (startsNewTurn) return true;
  const currentState = normalizeState(arguments[0]?.current?.state);
  const nextState = normalizeState(event.state);
  if (!FrontendTerminalStates.includes(nextState)) return false;
  if ([BackendChannelState.ERROR, BackendChannelState.STOPPED, FrontendRunState.CANCELLED].includes(currentState)) {
    return nextState === currentState;
  }
  return true;
}

export function isNotStaleSeqRegression({ currentPriority = 0, nextPriority = 0, staleSeq = false } = {}) {
  return !(staleSeq && nextPriority <= currentPriority);
}

export function isPriorityForwardOrNewTurn({ currentPriority = 0, nextPriority = 0, startsNewTurn = false } = {}) {
  return startsNewTurn || nextPriority >= currentPriority;
}

export function isBackendRunStateEvent(event = {}) {
  return [
    SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
    SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
    SESSION_RUN_EVENT.BACKEND_RECOVERABLE_RUNNING,
  ].includes(event.type);
}

export function isUnscopedBackendProtectedState(state = "") {
  return [
    BackendChannelState.STOPPING,
    ...FrontendTerminalStates,
  ].includes(normalizeState(state));
}

export function isUnscopedBackendStateForScopedTurn({ current = {}, event = {}, startsNewTurn = false } = {}) {
  if (startsNewTurn) return false;
  if (!isBackendRunStateEvent(event)) return false;
  if (!hasRunIdentity(current)) return false;
  if (hasRunIdentity(event)) return false;
  return isUnscopedBackendProtectedState(event.state);
}

export function isUnscopedLocalFailureForScopedTurn({ current = {}, event = {}, startsNewTurn = false } = {}) {
  if (startsNewTurn) return false;
  if (event.type !== SESSION_RUN_EVENT.LOCAL_FAILURE) return false;
  if (!hasRunIdentity(current)) return false;
  return !hasRunIdentity(event);
}
