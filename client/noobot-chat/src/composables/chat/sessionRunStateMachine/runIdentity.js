/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  BackendChannelState,
  BackendTerminalStates,
  FrontendTerminalStates,
  FrontendRunState,
  SESSION_RUN_EVENT,
  SESSION_RUN_TRANSITION_RULE,
  USER_STOP_LOCK_REOPEN_STATES,
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
  if (event?.authoritativeSnapshot === true) {
    const currentSessionId = trim(current?.sessionId);
    const eventSessionId = trim(event?.sessionId);
    return Boolean(
      eventSessionId &&
      (!currentSessionId || currentSessionId === eventSessionId) &&
      resolveEventScope(event),
    );
  }
  if (![
    SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
    SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_STARTED,
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
  if (isSameSessionUserStoppedRefresh({ current, event })) return true;
  return sameConversationScope(current, event) || startsNewTurn || canBindBackendDialogProcessIdByTurnScope(current, event);
}

export function isSameSessionUserStoppedRefresh({ current = {}, event = {} } = {}) {
  if (normalizeState(event.backendState) !== BackendChannelState.USER_STOPPED) return false;
  const currentSessionId = trim(current.sessionId);
  const eventSessionId = trim(event.sessionId);
  if (currentSessionId && eventSessionId && currentSessionId !== eventSessionId) return false;
  if (!hasRunIdentity(event)) return false;
  if (hasRunIdentity(current)) {
    return sameConversationScope(current, event);
  }
  const currentSeq = Number(current.seq || 0);
  const eventSeq = Number(event.seq || 0);
  return eventSeq > 0 && eventSeq > currentSeq;
}

export function isNotReopeningStopLock({ current = {}, event = {}, startsNewTurn = false, currentRule = "" } = {}) {
  if (currentRule !== SESSION_RUN_TRANSITION_RULE.USER_STOP_LOCKED) return true;
  if (startsNewTurn) return true;
  return !USER_STOP_LOCK_REOPEN_STATES.includes(event.state);
}

export function isNotLeavingTerminal({ current = {}, event = {}, startsNewTurn = false, currentRule = "" } = {}) {
  if (currentRule !== SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED) return true;
  if (startsNewTurn) return true;
  const currentState = normalizeState(current?.state);
  const nextState = normalizeState(event.state);
  if (isNewerBackendTerminalFactForSameRun({ current, event })) return true;
  if (!FrontendTerminalStates.includes(nextState)) return false;
  if ([BackendChannelState.ERROR, FrontendRunState.USER_STOP_COMPLETED, FrontendRunState.CANCELLED].includes(currentState)) {
    return nextState === currentState;
  }
  return true;
}

export function isNewerBackendTerminalFactForSameRun({ current = {}, event = {} } = {}) {
  const currentBackendState = normalizeState(current?.backendState);
  const eventBackendState = normalizeState(event?.backendState);
  if (!BackendTerminalStates.includes(currentBackendState)) return false;
  if (!BackendTerminalStates.includes(eventBackendState)) return false;
  const currentSeq = Number(current?.seq || 0);
  const eventSeq = Number(event?.seq || 0);
  if (!(currentSeq > 0 && eventSeq > currentSeq)) return false;
  const currentSessionId = trim(current?.sessionId);
  const eventSessionId = trim(event?.sessionId);
  const currentDialogProcessId = trim(current?.dialogProcessId);
  const eventDialogProcessId = trim(event?.dialogProcessId);
  const currentTurnScopeId = trim(current?.turnScopeId);
  const eventTurnScopeId = trim(event?.turnScopeId);
  return Boolean(
    currentSessionId && eventSessionId && currentSessionId === eventSessionId &&
    currentDialogProcessId && eventDialogProcessId && currentDialogProcessId === eventDialogProcessId &&
    currentTurnScopeId && eventTurnScopeId && currentTurnScopeId === eventTurnScopeId
  );
}

export function isNotStaleSeqRegression({ currentPriority = 0, nextPriority = 0, staleSeq = false } = {}) {
  return !(staleSeq && nextPriority <= currentPriority);
}

function isBackendRunningFeedbackForFrontendRequestState(current = {}, event = {}) {
  const currentState = normalizeState(current.state);
  const nextState = normalizeState(event.state);
  return [
    FrontendRunState.CONTINUE_REQUESTING,
    FrontendRunState.RESEND_REPLACING_TURN,
    FrontendRunState.RESEND_STREAMING,
  ].includes(currentState) && [
    BackendChannelState.SENDING,
    BackendChannelState.RECONNECTING,
    BackendChannelState.INTERACTION_PENDING,
  ].includes(nextState) && hasMatchingRunTurnIdentity(current, event);
}

export function isPriorityForwardOrNewTurn({ current = {}, event = {}, currentPriority = 0, nextPriority = 0, startsNewTurn = false } = {}) {
  if (isNewerBackendTerminalFactForSameRun({ current, event })) return true;
  if (isBackendRunningFeedbackForFrontendRequestState(current, event)) return true;
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
    FrontendRunState.USER_STOPPING,
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
