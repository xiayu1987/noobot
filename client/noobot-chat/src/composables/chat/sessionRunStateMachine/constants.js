/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

export const USER_STOP_REQUEST_STORAGE_KEY = "noobot:session-run-state-machine:user-stop-requests:v1";
export const USER_STOP_REQUEST_TTL_MS = TIME_THRESHOLDS.client.stopRequestTtlMs;
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
  USER_STOPPED: "user_stopped",
  ERROR: "error",
  EXPIRED: "expired",
});

export const BackendTerminalStates = Object.freeze([
  BackendChannelState.COMPLETED,
  BackendChannelState.USER_STOPPED,
  BackendChannelState.ERROR,
  BackendChannelState.EXPIRED,
  BackendChannelState.NO_CONVERSATION,
]);

export const FrontendRunState = Object.freeze({
  IDLE: "idle",
  ACTION_REQUESTING: "frontend_action_requesting",
  PROCESSING: "frontend_processing",
  RESEND_REPLACING_TURN: "resend_replacing_turn",
  RESEND_STREAMING: "resend_streaming",
  CONTINUE_REQUESTING: "continue_requesting",
  USER_STOPPING: "frontend_user_stopping",
  USER_STOP_COMPLETED: "frontend_user_stop_completed",
  FRONTEND_COMPLETION_REQUESTING: "frontend_completion_requesting",
  FRONTEND_COMPLETED: "frontend_completed",
  CANCELLED: "cancelled",
  ACTION_REQUEST_ERROR: "frontend_action_request_error",
  PROCESSING_ERROR: "frontend_processing_error",
  COMPLETION_ERROR: "frontend_completion_error",
  STOP_ERROR: "frontend_stop_error",
});

export const FrontendTerminalStates = Object.freeze([
  FrontendRunState.FRONTEND_COMPLETED,
  FrontendRunState.USER_STOP_COMPLETED,
  FrontendRunState.CANCELLED,
  BackendChannelState.ERROR,
  BackendChannelState.EXPIRED,
  BackendChannelState.NO_CONVERSATION,
  FrontendRunState.ACTION_REQUEST_ERROR,
  FrontendRunState.PROCESSING_ERROR,
  FrontendRunState.COMPLETION_ERROR,
  FrontendRunState.STOP_ERROR,
]);

export const SESSION_RUN_EVENT = Object.freeze({
  LOCAL_SEND_STARTED: "local_send_started",
  LOCAL_SEND_REQUEST_STARTED: "local_send_request_started",
  LOCAL_SEND_REQUEST_SETTLED: "local_send_request_settled",
  LOCAL_CONTINUE_REQUEST_STARTED: "local_continue_request_started",
  LOCAL_CONTINUE_REQUEST_SETTLED: "local_continue_request_settled",
  LOCAL_RESEND_STARTED: "local_resend_started",
  LOCAL_RESEND_REPLACING_TURN: "local_resend_replacing_turn",
  LOCAL_RESEND_STREAMING: "local_resend_streaming",
  LOCAL_RESEND_COMPLETED: "local_resend_completed",
  LOCAL_RESEND_FAILED: "local_resend_failed",
  LOCAL_FRONTEND_COMPLETION_REQUEST_STARTED: "local_frontend_completion_request_started",
  LOCAL_FRONTEND_COMPLETION_APPLIED: "local_frontend_completion_applied",
  LOCAL_FRONTEND_COMPLETION_FAILED: "local_frontend_completion_failed",
  LOCAL_USER_STOP_REQUESTED: "local_user_stop_requested",
  LOCAL_USER_STOP_REQUEST_STARTED: "local_user_stop_request_started",
  LOCAL_USER_STOP_REQUEST_SETTLED: "local_user_stop_request_settled",
  LOCAL_USER_STOP_PENDING_BACKEND_READY: "local_user_stop_pending_backend_ready",
  LOCAL_USER_STOP_PENDING_CLEARED: "local_user_stop_pending_cleared",
  LOCAL_USER_STOP_SUMMARY_APPLIED: "local_user_stop_summary_applied",
  LOCAL_USER_STOP_SUMMARY_FAILED: "local_user_stop_summary_failed",
  BACKEND_CONVERSATION_STATE: "backend_conversation_state",
  BACKEND_CHANNEL_STATE: "backend_channel_state",
  BACKEND_TURN_LIFECYCLE: "backend_turn_lifecycle",
  LOCAL_FAILURE: "local_failure",
  LOCAL_RESET: "local_reset",
});

export const IN_FLIGHT_STATES = Object.freeze([
  FrontendRunState.ACTION_REQUESTING,
  FrontendRunState.PROCESSING,
  BackendChannelState.SENDING,
  BackendChannelState.RECONNECTING,
  BackendChannelState.INTERACTION_PENDING,
  FrontendRunState.CONTINUE_REQUESTING,
  FrontendRunState.RESEND_REPLACING_TURN,
  FrontendRunState.RESEND_STREAMING,
  BackendChannelState.COMPLETED,
  FrontendRunState.FRONTEND_COMPLETION_REQUESTING,
  FrontendRunState.USER_STOPPING,
]);

export const MESSAGE_IN_FLIGHT_CHANNEL_STATES = Object.freeze([
  FrontendRunState.ACTION_REQUESTING,
  BackendChannelState.SENDING,
  BackendChannelState.RECONNECTING,
  BackendChannelState.INTERACTION_PENDING,
  FrontendRunState.CONTINUE_REQUESTING,
  FrontendRunState.RESEND_REPLACING_TURN,
  FrontendRunState.RESEND_STREAMING,
  FrontendRunState.USER_STOPPING,
]);

export const USER_STOP_LOCK_STATES = Object.freeze([
  FrontendRunState.USER_STOPPING,
]);

export const USER_STOP_LOCK_REOPEN_STATES = Object.freeze([
  FrontendRunState.ACTION_REQUESTING,
  BackendChannelState.SENDING,
  BackendChannelState.RECONNECTING,
  FrontendRunState.CONTINUE_REQUESTING,
  FrontendRunState.RESEND_REPLACING_TURN,
  FrontendRunState.RESEND_STREAMING,
]);

export const SESSION_RUN_TRANSITION_RULE = Object.freeze({
  PRIORITY_FORWARD: "priority_forward",
  USER_STOP_LOCKED: "user_stop_locked",
  TERMINAL_LOCKED: "terminal_locked",
});

export const SESSION_RUN_TRANSITION_GUARD_ID = Object.freeze({
  HAS_EVENT_STATE: "has_event_state",
  SAME_CONVERSATION_SCOPE_OR_NEW_TURN: "same_conversation_scope_or_new_turn",
  USER_STOP_LOCK_NOT_REOPENED: "user_stop_lock_not_reopened",
  TERMINAL_NOT_REOPENED: "terminal_not_reopened",
  NO_STALE_SEQ_REGRESSION: "no_stale_seq_regression",
  PRIORITY_FORWARD_OR_NEW_TURN: "priority_forward_or_new_turn",
});

export const SESSION_RUN_TRANSITION_DECISION_REASON = Object.freeze({
  APPLIED: "applied",
  LOCAL_RESET: "local_reset",
  MISSING_EVENT_STATE: "missing_event_state",
  DIFFERENT_SCOPE: "different_scope",
  USER_STOP_LOCK_REOPEN: "user_stop_lock_reopen",
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
  [SESSION_RUN_TRANSITION_RULE.USER_STOP_LOCKED]: Object.freeze([
    SESSION_RUN_TRANSITION_GUARD_ID.USER_STOP_LOCK_NOT_REOPENED,
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
  [FrontendRunState.ACTION_REQUESTING]: createTransitionConfig(30),
  [FrontendRunState.PROCESSING]: createTransitionConfig(40),
  [BackendChannelState.SENDING]: createTransitionConfig(40),
  [BackendChannelState.RECONNECTING]: createTransitionConfig(40),
  [FrontendRunState.CONTINUE_REQUESTING]: createTransitionConfig(45),
  [BackendChannelState.INTERACTION_PENDING]: createTransitionConfig(50),
  [FrontendRunState.RESEND_REPLACING_TURN]: createTransitionConfig(55),
  [FrontendRunState.RESEND_STREAMING]: createTransitionConfig(60),
  [FrontendRunState.USER_STOPPING]: createTransitionConfig(80, SESSION_RUN_TRANSITION_RULE.USER_STOP_LOCKED),
  [BackendChannelState.COMPLETED]: createTransitionConfig(90),
  [FrontendRunState.FRONTEND_COMPLETION_REQUESTING]: createTransitionConfig(95),
  [FrontendRunState.FRONTEND_COMPLETED]: createTransitionConfig(100, SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED),
  [FrontendRunState.USER_STOP_COMPLETED]: createTransitionConfig(100, SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED),
  [BackendChannelState.ERROR]: createTransitionConfig(100, SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED),
  [BackendChannelState.EXPIRED]: createTransitionConfig(100, SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED),
  [BackendChannelState.NO_CONVERSATION]: createTransitionConfig(100, SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED),
  [FrontendRunState.CANCELLED]: createTransitionConfig(110, SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED),
  [FrontendRunState.ACTION_REQUEST_ERROR]: createTransitionConfig(100, SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED),
  [FrontendRunState.PROCESSING_ERROR]: createTransitionConfig(100, SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED),
  [FrontendRunState.COMPLETION_ERROR]: createTransitionConfig(100, SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED),
  [FrontendRunState.STOP_ERROR]: createTransitionConfig(100, SESSION_RUN_TRANSITION_RULE.TERMINAL_LOCKED),
});
