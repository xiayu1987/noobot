/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { requireOptionalCanonicalTurnScopeId } from "./identity/turn-scope-identity.js";
import { TURN_STATE } from "./lifecycle/turn-state.js";
import {
  collectTurnFailureErrors,
  collectFinalizeIntentErrors,
  collectTurnContinuationErrors,
} from "./lifecycle/turn-record.js";

export const SESSION_RUN_EVENT = Object.freeze({
  LOCAL_SEND_STARTED: "local_send_started",
  LOCAL_SEND_REQUEST_STARTED: "local_send_request_started",
  LOCAL_SEND_REQUEST_SETTLED: "local_send_request_settled",
  LOCAL_CONTINUE_REQUEST_STARTED: "local_continue_request_started",
  LOCAL_CONTINUE_REQUEST_SETTLED: "local_continue_request_settled",
  LOCAL_RESEND_STARTED: "local_resend_started",
  LOCAL_RESEND_REPLACING_TURN: "local_resend_replacing_turn",
  LOCAL_RESEND_STREAMING: "local_resend_streaming",
  LOCAL_RESEND_FAILED: "local_resend_failed",
  LOCAL_FRONTEND_COMPLETION_REQUEST_STARTED: "local_frontend_completion_request_started",
  LOCAL_FRONTEND_COMPLETION_FAILED: "local_frontend_completion_failed",
  LOCAL_USER_STOP_REQUESTED: "local_user_stop_requested",
  LOCAL_USER_STOP_REQUEST_STARTED: "local_user_stop_request_started",
  LOCAL_USER_STOP_REQUEST_SETTLED: "local_user_stop_request_settled",
  LOCAL_USER_STOP_PENDING_BACKEND_READY: "local_user_stop_pending_backend_ready",
  LOCAL_USER_STOP_PENDING_CLEARED: "local_user_stop_pending_cleared",
  BACKEND_CONVERSATION_STATE: "backend_conversation_state",
  BACKEND_CHANNEL_STATE: "backend_channel_state",
  BACKEND_TURN_LIFECYCLE: "backend_turn_lifecycle",
  TERMINAL_RESOLVED: "turn_terminal_resolved",
  LOCAL_RESET: "local_reset",
});

export const TRANSPORT_EVENT_TYPES = new Set([
  SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
  SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
]);
export const AUTHORITATIVE_EVENT_TYPES = new Set([
  SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
  SESSION_RUN_EVENT.TERMINAL_RESOLVED,
]);
export const TURN_RUNTIME_AUTHORITY = Object.freeze({
  NONE: "none",
  AUTHORITATIVE_DETAIL_APPLIED: "authoritative_detail_applied",
  AUTHORITATIVE_DETAIL_FAILED: "authoritative_detail_failed",
});
const eventTypes = new Set(Object.values(SESSION_RUN_EVENT));
const turnStates = new Set(Object.values(TURN_STATE));

export function requireRuntimeIsoTime(value, field) {
  const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value)
    throw new TypeError(`invalid_runtime_${field}`);
  return timestamp;
}

function optionalText(event, field) {
  if (!Object.hasOwn(event, field)) return "";
  if (event[field] !== "" && !isCanonicalText(event[field]))
    throw new TypeError(`invalid_runtime_${field}`);
  return event[field];
}

function integer(event, field, required = false) {
  if (!Object.hasOwn(event, field) && !required) return 0;
  if (!Number.isSafeInteger(event[field]) || event[field] < (required ? 1 : 0))
    throw new TypeError(`invalid_runtime_${field}`);
  return event[field];
}

function authorityFor(type) {
  if (type === SESSION_RUN_EVENT.TERMINAL_RESOLVED)
    return TURN_RUNTIME_AUTHORITY.AUTHORITATIVE_DETAIL_APPLIED;
  if (type === SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_FAILED)
    return TURN_RUNTIME_AUTHORITY.AUTHORITATIVE_DETAIL_FAILED;
  return TURN_RUNTIME_AUTHORITY.NONE;
}

function projectIdentity(event, authoritative) {
  const identity = Object.fromEntries(
    ["eventId", "action", "commandId", "sessionId", "parentSessionId", "dialogProcessId"].map(
      (field) => [field, optionalText(event, field)],
    ),
  );
  identity.turnScopeId = Object.hasOwn(event, "turnScopeId")
    ? requireOptionalCanonicalTurnScopeId(event.turnScopeId)
    : "";
  if (authoritative && (!identity.sessionId || !identity.turnScopeId || !identity.dialogProcessId))
    throw new TypeError("missing_runtime_authoritative_identity");
  return identity;
}

function projectTimes(event, authoritative, transport) {
  const times = Object.fromEntries(
    ["createdAt", "updatedAt", "startedAt", "finishedAt", "thinkingFinishedAt"].map((field) => {
      const value = optionalText(event, field);
      if (value) requireRuntimeIsoTime(value, field);
      return [field, value];
    }),
  );
  const updatedAtMs = integer(event, "updatedAtMs");
  const createdAtMs = integer(event, "createdAtMs");
  let timestamp;
  if (authoritative) {
    timestamp = requireRuntimeIsoTime(event.updatedAt, "updatedAt");
    if (Object.hasOwn(event, "updatedAtMs") && updatedAtMs !== timestamp)
      throw new TypeError("runtime_time_conflict");
  } else if (transport) {
    timestamp = integer(event, "updatedAtMs", true);
    if (times.updatedAt && requireRuntimeIsoTime(times.updatedAt, "updatedAt") !== timestamp)
      throw new TypeError("runtime_time_conflict");
  } else timestamp = integer(event, "timestamp", true);
  return { ...times, createdAtMs, updatedAtMs, timestamp };
}

function requireRuntimeNestedFields(event) {
  if (Object.hasOwn(event, "failure")) {
    const errors = collectTurnFailureErrors(event.failure);
    if (errors.length) throw new TypeError(errors.join(","));
  }
  if (Object.hasOwn(event, "finalizeIntent")) {
    const errors = collectFinalizeIntentErrors(event.finalizeIntent);
    if (errors.length) throw new TypeError(errors.join(","));
  }
  if (Object.hasOwn(event, "continuationSource")) {
    const errors = collectTurnContinuationErrors(event);
    if (errors.length) throw new TypeError(errors.join(","));
  }
  if (
    event.capabilities !== undefined &&
    (!isPlainObject(event.capabilities) ||
      typeof event.capabilities.canStop !== "boolean" ||
      typeof event.capabilities.actionLocked !== "boolean" ||
      Object.keys(event.capabilities).some((field) => !["canStop", "actionLocked"].includes(field)))
  )
    throw new TypeError("invalid_runtime_capabilities");
  if (
    Object.hasOwn(event, "authoritativeSnapshot") &&
    typeof event.authoritativeSnapshot !== "boolean"
  )
    throw new TypeError("invalid_runtime_authoritativeSnapshot");
}

export function projectSessionRunEvent(event) {
  if (!isPlainObject(event) || !eventTypes.has(event.type))
    throw new TypeError("invalid_runtime_event_type");
  const authoritative = AUTHORITATIVE_EVENT_TYPES.has(event.type);
  const transport = TRANSPORT_EVENT_TYPES.has(event.type);
  const state = optionalText(event, "state");
  if (authoritative && !turnStates.has(state)) throw new TypeError("invalid_runtime_turn_state");
  requireRuntimeNestedFields(event);
  if (transport && !Object.hasOwn(event, "seq")) throw new TypeError("invalid_runtime_seq");
  const seq = integer(event, "seq", authoritative);
  const revision = integer(event, "revision", authoritative);
  const authority = authorityFor(event.type);
  if (Object.hasOwn(event, "authority") && event.authority !== authority)
    throw new TypeError("runtime_authority_conflict");
  return {
    type: event.type,
    state,
    backendState: transport ? state : optionalText(event, "executionState"),
    ...projectIdentity(event, authoritative),
    source: Object.hasOwn(event, "source") ? optionalText(event, "source") : event.type,
    authority,
    authoritativeSnapshot: event.authoritativeSnapshot === true,
    sourceEvent: optionalText(event, "sourceEvent"),
    seq,
    transportSeq: transport ? seq : 0,
    lifecycleSeq: authoritative ? seq : 0,
    revision,
    summaryVersion: integer(event, "summaryVersion"),
    completionCommitId: optionalText(event, "completionCommitId"),
    authoritativeTurnState: event.type === SESSION_RUN_EVENT.TERMINAL_RESOLVED ? state : "",
    finalizeIntent: Object.hasOwn(event, "finalizeIntent") ? event.finalizeIntent : null,
    failure: Object.hasOwn(event, "failure") ? event.failure : null,
    continuationSource: Object.hasOwn(event, "continuationSource")
      ? event.continuationSource
      : null,
    continuedByTurnScopeId: optionalText(event, "continuedByTurnScopeId"),
    canStop: event.capabilities?.canStop === true,
    eventType: optionalText(event, "eventType"),
    phase: optionalText(event, "phase"),
    ...projectTimes(event, authoritative, transport),
  };
}

export function createLocalSessionRunEvent(event, timestamp) {
  if (!isPlainObject(event) || !event.type?.startsWith("local_") || !eventTypes.has(event.type))
    throw new TypeError("invalid_local_runtime_event");
  const input = { ...event, timestamp };
  projectSessionRunEvent(input);
  return input;
}

export function projectTurnLifecycleRuntimeEvent(envelope) {
  if (Object.hasOwn(envelope, "seq") && envelope.seq !== envelope.sequence)
    throw new TypeError("runtime_sequence_conflict");
  return projectSessionRunEvent({
    ...envelope,
    type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
    seq: envelope.sequence,
    failure: envelope.failure === undefined ? null : envelope.failure,
    continuationSource:
      envelope.continuationSource === undefined ? null : envelope.continuationSource,
    source: "turn_lifecycle",
  });
}

export function projectTurnTerminalRuntimeEvent(response) {
  return projectSessionRunEvent({
    ...response.turn,
    type: SESSION_RUN_EVENT.TERMINAL_RESOLVED,
    seq: response.turn.sequence,
    source: "authoritative_terminal_service",
  });
}
