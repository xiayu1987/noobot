/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

export const STOP_REQUEST_STORAGE_KEY = "noobot:session-run-state-machine:stop-requests:v1";
export const STOP_REQUEST_TTL_MS = TIME_THRESHOLDS.client.stopRequestTtlMs;
export const SESSION_RUN_MESSAGE_RUNTIME_MARK = "__noobotRuntimeRunStateKey";
export const SESSION_RUN_MESSAGE_RUNTIME_ACTION = Object.freeze({
  NONE: "none",
  PATCH_MESSAGE: "patch_message",
});
export const SESSION_RUN_MESSAGE_RUNTIME_REASON = Object.freeze({
  IN_FLIGHT_MATCH: "in_flight_match",
  RUNTIME_STATE_NO_LONGER_MATCHES: "runtime_state_no_longer_matches",
  OBSOLETE_PENDING_ASSISTANT: "obsolete_pending_assistant",
});

export const SESSION_RUN_STATE = Object.freeze({
  IDLE: "idle",
  SENDING: "sending",
  RECONNECTING: "reconnecting",
  INTERACTION_PENDING: "interaction_pending",
  STOP_REQUESTED: "stop_requested",
  STOPPING: "stopping",
  STOPPED: "stopped",
  COMPLETED: "completed",
  ERROR: "error",
  EXPIRED: "expired",
  NO_CONVERSATION: "no_conversation",
  CANCELLED: "cancelled",
  CANCELED: "canceled",
});

export const SESSION_RUN_EVENT = Object.freeze({
  LOCAL_SEND_STARTED: "local_send_started",
  LOCAL_STOP_REQUESTED: "local_stop_requested",
  BACKEND_RECOVERABLE_RUNNING: "backend_recoverable_running",
  BACKEND_CONVERSATION_STATE: "backend_conversation_state",
  BACKEND_CHANNEL_STATE: "backend_channel_state",
  LOCAL_FAILURE: "local_failure",
  LOCAL_RESET: "local_reset",
});

export const TERMINAL_STATES = Object.freeze([
  SESSION_RUN_STATE.STOPPED,
  SESSION_RUN_STATE.COMPLETED,
  SESSION_RUN_STATE.ERROR,
  SESSION_RUN_STATE.EXPIRED,
  SESSION_RUN_STATE.NO_CONVERSATION,
  SESSION_RUN_STATE.CANCELLED,
  SESSION_RUN_STATE.CANCELED,
]);

export const IN_FLIGHT_STATES = Object.freeze([
  SESSION_RUN_STATE.SENDING,
  SESSION_RUN_STATE.RECONNECTING,
  SESSION_RUN_STATE.INTERACTION_PENDING,
  SESSION_RUN_STATE.STOP_REQUESTED,
  SESSION_RUN_STATE.STOPPING,
]);

export const MESSAGE_IN_FLIGHT_CHANNEL_STATES = Object.freeze([
  SESSION_RUN_STATE.SENDING,
  SESSION_RUN_STATE.RECONNECTING,
  SESSION_RUN_STATE.INTERACTION_PENDING,
  SESSION_RUN_STATE.STOPPING,
]);

export const STOP_LOCK_STATES = Object.freeze([
  SESSION_RUN_STATE.STOP_REQUESTED,
  SESSION_RUN_STATE.STOPPING,
  SESSION_RUN_STATE.STOPPED,
  SESSION_RUN_STATE.CANCELLED,
  SESSION_RUN_STATE.CANCELED,
]);

export const STOP_LOCK_REOPEN_STATES = Object.freeze([
  SESSION_RUN_STATE.SENDING,
  SESSION_RUN_STATE.RECONNECTING,
]);

export const SESSION_RUN_TRANSITION_RULE = Object.freeze({
  PRIORITY_FORWARD: "priority_forward",
  STOP_LOCKED: "stop_locked",
  TERMINAL_LOCKED: "terminal_locked",
});

export const SESSION_RUN_TRANSITION_GUARD_ID = Object.freeze({
  HAS_EVENT_STATE: "has_event_state",
  SAME_CONVERSATION_SCOPE_OR_NEW_TURN: "same_conversation_scope_or_new_turn",
  STOP_LOCK_NOT_REOPENED: "stop_lock_not_reopened",
  TERMINAL_NOT_REOPENED: "terminal_not_reopened",
  NO_STALE_SEQ_REGRESSION: "no_stale_seq_regression",
  PRIORITY_FORWARD_OR_NEW_TURN: "priority_forward_or_new_turn",
});

export const SESSION_RUN_TRANSITION_DECISION_REASON = Object.freeze({
  APPLIED: "applied",
  LOCAL_RESET: "local_reset",
  MISSING_EVENT_STATE: "missing_event_state",
  DIFFERENT_SCOPE: "different_scope",
  STOP_LOCK_REOPEN: "stop_lock_reopen",
  TERMINAL_LOCK_REOPEN: "terminal_lock_reopen",
  STALE_SEQ_REGRESSION: "stale_seq_regression",
  PRIORITY_REGRESSION: "priority_regression",
});

export const COMMON_TRANSITION_GUARD_IDS = Object.freeze([
  SESSION_RUN_TRANSITION_GUARD_ID.HAS_EVENT_STATE,
  SESSION_RUN_TRANSITION_GUARD_ID.SAME_CONVERSATION_SCOPE_OR_NEW_TURN,
]);

export const FINAL_TRANSITION_GUARD_IDS = Object.freeze([
  SESSION_RUN_TRANSITION_GUARD_ID.NO_STALE_SEQ_REGRESSION,
  SESSION_RUN_TRANSITION_GUARD_ID.PRIORITY_FORWARD_OR_NEW_TURN,
]);

export const SESSION_RUN_TRANSITION_RULE_GUARDS = Object.freeze({
  [SESSION_RUN_TRANSITION_RULE.PRIORITY_FORWARD]: Object.freeze([]),
  [SESSION_RUN_TRANSITION_RULE.STOP_LOCKED]: Object.freeze([
    SESSION_RUN_TRANSITION_GUARD_ID.STOP_LOCK_NOT_REOPENED,
  ]),
  [SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED]: Object.freeze([
    SESSION_RUN_TRANSITION_GUARD_ID.TERMINAL_NOT_REOPENED,
  ]),
});

function createTransitionConfig(priority, rule = SESSION_RUN_TRANSITION_RULE.PRIORITY_FORWARD) {
  return Object.freeze({
    priority,
    rule,
    guards: Object.freeze([
      ...COMMON_TRANSITION_GUARD_IDS,
      ...(SESSION_RUN_TRANSITION_RULE_GUARDS[rule] || []),
      ...FINAL_TRANSITION_GUARD_IDS,
    ]),
  });
}

export const SESSION_RUN_TRANSITION_TABLE = Object.freeze({
  [SESSION_RUN_STATE.IDLE]: createTransitionConfig(0),
  [SESSION_RUN_STATE.SENDING]: createTransitionConfig(40),
  [SESSION_RUN_STATE.RECONNECTING]: createTransitionConfig(40),
  [SESSION_RUN_STATE.INTERACTION_PENDING]: createTransitionConfig(50),
  [SESSION_RUN_STATE.STOP_REQUESTED]: createTransitionConfig(70, SESSION_RUN_TRANSITION_RULE.STOP_LOCKED),
  [SESSION_RUN_STATE.STOPPING]: createTransitionConfig(80, SESSION_RUN_TRANSITION_RULE.STOP_LOCKED),
  [SESSION_RUN_STATE.COMPLETED]: createTransitionConfig(100, SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED),
  [SESSION_RUN_STATE.ERROR]: createTransitionConfig(100, SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED),
  [SESSION_RUN_STATE.EXPIRED]: createTransitionConfig(100, SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED),
  [SESSION_RUN_STATE.NO_CONVERSATION]: createTransitionConfig(100, SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED),
  [SESSION_RUN_STATE.STOPPED]: createTransitionConfig(110, SESSION_RUN_TRANSITION_RULE.STOP_LOCKED),
  [SESSION_RUN_STATE.CANCELLED]: createTransitionConfig(110, SESSION_RUN_TRANSITION_RULE.STOP_LOCKED),
  [SESSION_RUN_STATE.CANCELED]: createTransitionConfig(110, SESSION_RUN_TRANSITION_RULE.STOP_LOCKED),
});
