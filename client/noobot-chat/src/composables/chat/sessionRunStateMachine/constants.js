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

export const BackendChannelState = Object.freeze({
  NO_CONVERSATION: "no_conversation",
  SENDING: "sending",
  INTERACTION_PENDING: "interaction_pending",
  STOPPING: "stopping",
  RECONNECTING: "reconnecting",
  COMPLETED: "completed",
  STOPPED: "stopped",
  ERROR: "error",
  EXPIRED: "expired",
});

export const BackendTerminalStates = Object.freeze([
  BackendChannelState.COMPLETED,
  BackendChannelState.STOPPED,
  BackendChannelState.ERROR,
  BackendChannelState.EXPIRED,
  BackendChannelState.NO_CONVERSATION,
]);

export const FrontendRunState = Object.freeze({
  IDLE: "idle",
  RESEND_REPLACING_TURN: "resend_replacing_turn",
  RESEND_STREAMING: "resend_streaming",
  STOP_REQUESTED: "stop_requested",
  FRONTEND_COMPLETION_REQUESTING: "frontend_completion_requesting",
  FRONTEND_COMPLETED: "frontend_completed",
  CANCELLED: "cancelled",
});

export const FrontendTerminalStates = Object.freeze([
  FrontendRunState.FRONTEND_COMPLETED,
  FrontendRunState.CANCELLED,
  BackendChannelState.STOPPED,
  BackendChannelState.ERROR,
  BackendChannelState.EXPIRED,
  BackendChannelState.NO_CONVERSATION,
]);

export const SESSION_RUN_EVENT = Object.freeze({
  LOCAL_SEND_STARTED: "local_send_started",
  LOCAL_SEND_REQUEST_STARTED: "local_send_request_started",
  LOCAL_SEND_REQUEST_SETTLED: "local_send_request_settled",
  LOCAL_RESEND_STARTED: "local_resend_started",
  LOCAL_RESEND_REPLACING_TURN: "local_resend_replacing_turn",
  LOCAL_RESEND_STREAMING: "local_resend_streaming",
  LOCAL_RESEND_COMPLETED: "local_resend_completed",
  LOCAL_RESEND_FAILED: "local_resend_failed",
  LOCAL_FRONTEND_COMPLETION_REQUEST_STARTED: "local_frontend_completion_request_started",
  LOCAL_FRONTEND_COMPLETION_APPLIED: "local_frontend_completion_applied",
  LOCAL_FRONTEND_COMPLETION_FAILED: "local_frontend_completion_failed",
  LOCAL_STOP_REQUESTED: "local_stop_requested",
  LOCAL_STOP_REQUEST_STARTED: "local_stop_request_started",
  LOCAL_STOP_REQUEST_SETTLED: "local_stop_request_settled",
  LOCAL_STOP_PENDING_BACKEND_READY: "local_stop_pending_backend_ready",
  LOCAL_STOP_PENDING_CLEARED: "local_stop_pending_cleared",
  BACKEND_RECOVERABLE_RUNNING: "backend_recoverable_running",
  BACKEND_CONVERSATION_STATE: "backend_conversation_state",
  BACKEND_CHANNEL_STATE: "backend_channel_state",
  LOCAL_FAILURE: "local_failure",
  LOCAL_RESET: "local_reset",
});

export const IN_FLIGHT_STATES = Object.freeze([
  BackendChannelState.SENDING,
  BackendChannelState.RECONNECTING,
  BackendChannelState.INTERACTION_PENDING,
  FrontendRunState.RESEND_REPLACING_TURN,
  FrontendRunState.RESEND_STREAMING,
  BackendChannelState.COMPLETED,
  FrontendRunState.FRONTEND_COMPLETION_REQUESTING,
  FrontendRunState.STOP_REQUESTED,
  BackendChannelState.STOPPING,
]);

export const MESSAGE_IN_FLIGHT_CHANNEL_STATES = Object.freeze([
  BackendChannelState.SENDING,
  BackendChannelState.RECONNECTING,
  BackendChannelState.INTERACTION_PENDING,
  FrontendRunState.RESEND_REPLACING_TURN,
  FrontendRunState.RESEND_STREAMING,
  BackendChannelState.STOPPING,
]);

export const STOP_LOCK_STATES = Object.freeze([
  FrontendRunState.STOP_REQUESTED,
  BackendChannelState.STOPPING,
  BackendChannelState.STOPPED,
  FrontendRunState.CANCELLED,
]);

export const STOP_LOCK_REOPEN_STATES = Object.freeze([
  BackendChannelState.SENDING,
  BackendChannelState.RECONNECTING,
  FrontendRunState.RESEND_REPLACING_TURN,
  FrontendRunState.RESEND_STREAMING,
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
  [FrontendRunState.IDLE]: createTransitionConfig(0),
  [BackendChannelState.SENDING]: createTransitionConfig(40),
  [BackendChannelState.RECONNECTING]: createTransitionConfig(40),
  [BackendChannelState.INTERACTION_PENDING]: createTransitionConfig(50),
  [FrontendRunState.RESEND_REPLACING_TURN]: createTransitionConfig(55),
  [FrontendRunState.RESEND_STREAMING]: createTransitionConfig(60),
  [FrontendRunState.STOP_REQUESTED]: createTransitionConfig(70, SESSION_RUN_TRANSITION_RULE.STOP_LOCKED),
  [BackendChannelState.STOPPING]: createTransitionConfig(80, SESSION_RUN_TRANSITION_RULE.STOP_LOCKED),
  [BackendChannelState.COMPLETED]: createTransitionConfig(90),
  [FrontendRunState.FRONTEND_COMPLETION_REQUESTING]: createTransitionConfig(95),
  [FrontendRunState.FRONTEND_COMPLETED]: createTransitionConfig(100, SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED),
  [BackendChannelState.ERROR]: createTransitionConfig(100, SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED),
  [BackendChannelState.EXPIRED]: createTransitionConfig(100, SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED),
  [BackendChannelState.NO_CONVERSATION]: createTransitionConfig(100, SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED),
  [BackendChannelState.STOPPED]: createTransitionConfig(110, SESSION_RUN_TRANSITION_RULE.STOP_LOCKED),
  [FrontendRunState.CANCELLED]: createTransitionConfig(110, SESSION_RUN_TRANSITION_RULE.STOP_LOCKED),
});
