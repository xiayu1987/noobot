/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text, isPlainObject, isCanonicalText } from "@noobot/shared/value";
import { TURN_SNAPSHOT_WIRE_EVENT } from "@noobot/session-protocol";
import { EXECUTION_QUERY_CONTRACT } from "@noobot/session-protocol/execution-lifecycle";

export const AGENT_TRANSPORT_EVENT = Object.freeze({
  READY: "transport_ready",
  ERROR: "transport_error",
  CHANNEL_ERROR: "channel_error",
  COMMAND_RECEIPT: "transport_command_receipt",
  COMMAND_REJECTED: "transport_command_rejected",
  CHANNEL_STATE: "channel_state",
  RECONNECT_DATA: "reconnect_data",
  RECONNECT_COMPLETE: "reconnect_complete",
});

export const AGENT_TRANSPORT_ERROR_CODE = Object.freeze({
  RECONNECT_FAILED: "RECONNECT_FAILED",
});

const EXACT_PAYLOAD_EVENTS = new Set([
  AGENT_TRANSPORT_EVENT.ERROR,
  AGENT_TRANSPORT_EVENT.CHANNEL_ERROR,
  AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
  AGENT_TRANSPORT_EVENT.COMMAND_REJECTED,
  AGENT_TRANSPORT_EVENT.CHANNEL_STATE,
]);

export function usesExactAgentTransportPayload(eventName) {
  return EXACT_PAYLOAD_EVENTS.has(text(eventName));
}

export const AGENT_CHANNEL_STATE = Object.freeze({
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

export const AGENT_CHANNEL_STATE_SCOPE = Object.freeze({
  SESSION: "session",
  TURN: "turn",
});

const CHANNEL_STATES = new Set(Object.values(AGENT_CHANNEL_STATE));
const CHANNEL_STATE_SCOPES = new Set(Object.values(AGENT_CHANNEL_STATE_SCOPE));
const CHANNEL_STATE_FIELDS = new Set([
  "protocolVersion",
  "scope",
  "sessionId",
  "turnScopeId",
  "dialogProcessId",
  "state",
  "sourceEvent",
  "seq",
  "createdAtMs",
  "updatedAtMs",
  "requestId",
]);
const TURN_ONLY_CHANNEL_STATE_FIELDS = ["turnScopeId", "dialogProcessId", "requestId"];

export function createAgentChannelState({
  scope = "",
  sessionId = "",
  turnScopeId = "",
  dialogProcessId = "",
  state = "",
  sourceEvent = "",
  seq = 0,
  createdAtMs = 0,
  updatedAtMs = 0,
  requestId = "",
} = {}) {
  const channelState = {
    protocolVersion: 1,
    scope: text(scope),
    sessionId: text(sessionId),
    state: text(state),
    sourceEvent: text(sourceEvent),
    seq: Number(seq),
    createdAtMs: Number(createdAtMs),
    updatedAtMs: Number(updatedAtMs),
    ...(text(turnScopeId) ? { turnScopeId: text(turnScopeId) } : {}),
    ...(text(dialogProcessId) ? { dialogProcessId: text(dialogProcessId) } : {}),
    ...(text(requestId) ? { requestId: text(requestId) } : {}),
  };
  const validation = validateAgentChannelState(channelState);
  if (!validation.valid) throw new TypeError(validation.errors.join(","));
  return Object.freeze(channelState);
}

function collectChannelStateScopeErrors(channelState, errors) {
  const scope = channelState.scope;
  if (!CHANNEL_STATE_SCOPES.has(scope)) {
    errors.push("invalid_channel_state_scope");
    return;
  }
  if (scope === AGENT_CHANNEL_STATE_SCOPE.TURN) {
    if (!text(channelState.turnScopeId)) errors.push("missing_channel_state_turn_scope_id");
    return;
  }
  for (const key of TURN_ONLY_CHANNEL_STATE_FIELDS) {
    if (channelState[key] !== undefined) errors.push(`session_channel_state_has_${key}`);
  }
}

export function validateAgentChannelState(channelState = {}) {
  const errors = [];
  if (!isPlainObject(channelState)) {
    return { valid: false, errors: ["channel_state_not_object"] };
  }
  for (const key of Object.keys(channelState)) {
    if (!CHANNEL_STATE_FIELDS.has(key)) errors.push(`unknown_channel_state_field:${key}`);
  }
  if (Number(channelState.protocolVersion) !== 1) errors.push("unsupported_channel_state_version");
  if (!text(channelState.sessionId)) errors.push("missing_channel_state_session_id");
  if (!CHANNEL_STATES.has(channelState.state)) errors.push("invalid_channel_state");
  if (!text(channelState.sourceEvent)) errors.push("missing_channel_state_source_event");
  if (!Number.isInteger(channelState.seq) || channelState.seq < 0) {
    errors.push("invalid_channel_state_seq");
  }
  for (const key of ["createdAtMs", "updatedAtMs"]) {
    if (!Number.isFinite(channelState[key]) || channelState[key] <= 0) {
      errors.push(`invalid_channel_state_${key}`);
    }
  }
  collectChannelStateScopeErrors(channelState, errors);
  return { valid: errors.length === 0, errors };
}

export const AGENT_COMMAND_RECEIPT_OUTCOME = Object.freeze({
  REBOUND: "rebound",
  COMPLETED: "completed",
  STOPPED: "stopped",
  FAILED: "failed",
});

const COMMAND_RECEIPT_OUTCOMES = new Set(Object.values(AGENT_COMMAND_RECEIPT_OUTCOME));

export function createAgentTransportError({
  code = "",
  message = "",
  commandId = "",
  identity = {},
  occurredAt = new Date().toISOString(),
} = {}) {
  const errorEvent = {
    protocolVersion: 1,
    code: text(code),
    message: text(message),
    occurredAt: text(occurredAt),
    ...(text(commandId) ? { commandId: text(commandId) } : {}),
    identity: {
      sessionId: text(identity.sessionId),
      turnScopeId: text(identity.turnScopeId),
      dialogProcessId: text(identity.dialogProcessId),
    },
  };
  const validation = validateAgentTransportError(errorEvent);
  if (!validation.valid) throw new TypeError(validation.errors.join(","));
  return Object.freeze(errorEvent);
}

export function validateAgentTransportError(errorEvent = {}) {
  const errors = [];
  if (!isPlainObject(errorEvent)) {
    return { valid: false, errors: ["transport_error_not_object"] };
  }
  const allowed = new Set([
    "protocolVersion",
    "code",
    "message",
    "commandId",
    "identity",
    "occurredAt",
  ]);
  for (const key of Object.keys(errorEvent)) {
    if (!allowed.has(key)) errors.push(`unknown_transport_error_field:${key}`);
  }
  if (Number(errorEvent.protocolVersion) !== 1) errors.push("unsupported_transport_error_version");
  if (!text(errorEvent.code)) errors.push("missing_transport_error_code");
  if (!text(errorEvent.message)) errors.push("missing_transport_error_message");
  if (!isPlainObject(errorEvent.identity)) {
    errors.push("transport_error_identity_not_object");
  } else {
    const identityAllowed = new Set(["sessionId", "turnScopeId", "dialogProcessId"]);
    for (const key of Object.keys(errorEvent.identity)) {
      if (!identityAllowed.has(key)) errors.push(`unknown_transport_error_identity_field:${key}`);
    }
  }
  if (!text(errorEvent.occurredAt) || Number.isNaN(Date.parse(errorEvent.occurredAt))) {
    errors.push("invalid_transport_error_occurred_at");
  }
  return { valid: errors.length === 0, errors };
}

const COMMAND_RESULT_IDENTITY_FIELDS = new Set(["sessionId", "turnScopeId", "dialogProcessId"]);
const COMMAND_RESULT_ERROR_FIELDS = new Set(["code", "message"]);
const RECEIPT_FIELDS = new Set([
  "protocolVersion",
  "commandId",
  "commandType",
  "outcome",
  "identity",
  "occurredAt",
  "error",
]);
const REJECTION_FIELDS = new Set([
  "protocolVersion",
  "commandId",
  "commandType",
  "identity",
  "occurredAt",
  "error",
]);

function collectUnknownFields(value, allowed, prefix, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${prefix}:${key}`);
  }
}

function projectCommandResultIdentity(identity) {
  return Object.fromEntries(
    [...COMMAND_RESULT_IDENTITY_FIELDS]
      .filter((key) => isCanonicalText(identity[key]))
      .map((key) => [key, identity[key]]),
  );
}

function validateCommandResultCommon(result, prefix, errors) {
  if (result.protocolVersion !== 1) errors.push(`unsupported_${prefix}_version`);
  if (!isCanonicalText(result.commandId)) errors.push("missing_command_id");
  if (!isCanonicalText(result.commandType)) errors.push("missing_command_type");
  if (!isPlainObject(result.identity)) {
    errors.push(`${prefix}_identity_not_object`);
  } else {
    collectUnknownFields(
      result.identity,
      COMMAND_RESULT_IDENTITY_FIELDS,
      `unknown_${prefix}_identity_field`,
      errors,
    );
    for (const key of Object.keys(result.identity)) {
      if (!isCanonicalText(result.identity[key])) {
        errors.push(`invalid_${prefix}_identity_field:${key}`);
      }
    }
    if (!isCanonicalText(result.identity.sessionId)) errors.push("missing_session_id");
  }
  if (!isCanonicalText(result.occurredAt) || Number.isNaN(Date.parse(result.occurredAt))) {
    errors.push("invalid_occurred_at");
  }
}

function validateCommandResultError(error, prefix, errors) {
  if (!isPlainObject(error)) {
    errors.push(`missing_${prefix}_error`);
    return;
  }
  collectUnknownFields(error, COMMAND_RESULT_ERROR_FIELDS, `unknown_${prefix}_error_field`, errors);
  if (!isCanonicalText(error.code)) errors.push(`missing_${prefix}_code`);
  if (!isCanonicalText(error.message)) errors.push(`missing_${prefix}_message`);
}

function freezeValid(result, validate) {
  const validation = validate(result);
  if (!validation.valid) throw new TypeError(validation.errors.join(","));
  return Object.freeze(result);
}

export function createAgentCommandReceipt({ command, outcome, error, occurredAt }) {
  return freezeValid(
    {
      protocolVersion: 1,
      commandId: command.commandId,
      commandType: command.commandType,
      outcome,
      identity: projectCommandResultIdentity(command.identity),
      occurredAt,
      ...(outcome === AGENT_COMMAND_RECEIPT_OUTCOME.FAILED
        ? { error: { code: error.code, message: error.message } }
        : {}),
    },
    validateAgentCommandReceipt,
  );
}

export function validateAgentCommandReceipt(receipt) {
  if (!isPlainObject(receipt)) return { valid: false, errors: ["receipt_not_object"] };
  const errors = [];
  collectUnknownFields(receipt, RECEIPT_FIELDS, "unknown_receipt_field", errors);
  validateCommandResultCommon(receipt, "receipt", errors);
  if (!COMMAND_RECEIPT_OUTCOMES.has(receipt.outcome)) errors.push("invalid_outcome");
  if (receipt.outcome === AGENT_COMMAND_RECEIPT_OUTCOME.FAILED) {
    validateCommandResultError(receipt.error, "receipt", errors);
  } else if (receipt.error !== undefined) {
    errors.push("unexpected_receipt_error");
  }
  return { valid: errors.length === 0, errors };
}

export function createAgentCommandRejection({ command, error, occurredAt }) {
  return freezeValid(
    {
      protocolVersion: 1,
      commandId: command.commandId,
      commandType: command.commandType,
      identity: projectCommandResultIdentity(command.identity),
      occurredAt,
      error: { code: error.code, message: error.message },
    },
    validateAgentCommandRejection,
  );
}

export function validateAgentCommandRejection(rejection) {
  if (!isPlainObject(rejection)) return { valid: false, errors: ["rejection_not_object"] };
  const errors = [];
  collectUnknownFields(rejection, REJECTION_FIELDS, "unknown_rejection_field", errors);
  validateCommandResultCommon(rejection, "rejection", errors);
  validateCommandResultError(rejection.error, "rejection", errors);
  return { valid: errors.length === 0, errors };
}

const DIRECT_TRANSPORT_EVENTS = new Set([
  AGENT_TRANSPORT_EVENT.READY,
  AGENT_TRANSPORT_EVENT.ERROR,
  AGENT_TRANSPORT_EVENT.COMMAND_REJECTED,
  AGENT_TRANSPORT_EVENT.RECONNECT_DATA,
  AGENT_TRANSPORT_EVENT.RECONNECT_COMPLETE,
  TURN_SNAPSHOT_WIRE_EVENT,
  ...Object.values(EXECUTION_QUERY_CONTRACT).map((contract) => contract.wireEvent),
]);
const DIRECT_FRAME_FIELDS = new Set(["event", "data"]);
const CHANNEL_FRAME_FIELDS = new Set(["event", "data", "channelSessionId"]);

function collectFrameErrors(frame, allowedFields) {
  if (!isPlainObject(frame)) return ["transport_frame_not_object"];
  const errors = [];
  for (const key of Object.keys(frame)) {
    if (!allowedFields.has(key)) errors.push(`unknown_transport_frame_field:${key}`);
  }
  if (!isCanonicalText(frame.event)) errors.push("missing_transport_event");
  if (!isPlainObject(frame.data)) errors.push("invalid_transport_event_data");
  return errors;
}

export function validateAgentDirectFrame(frame) {
  const errors = collectFrameErrors(frame, DIRECT_FRAME_FIELDS);
  if (!errors.length && !DIRECT_TRANSPORT_EVENTS.has(frame.event)) {
    errors.push(`channel_event_sent_direct:${frame.event}`);
  }
  return { valid: errors.length === 0, errors };
}

export function validateAgentChannelFrame(frame) {
  const errors = collectFrameErrors(frame, CHANNEL_FRAME_FIELDS);
  if (errors.length) return { valid: false, errors };
  if (!isCanonicalText(frame.channelSessionId)) errors.push("missing_channel_session_id");
  if (DIRECT_TRANSPORT_EVENTS.has(frame.event)) {
    errors.push(`direct_event_sent_on_channel:${frame.event}`);
  }
  return { valid: errors.length === 0, errors };
}

function freezeValidFrame(frame, validation) {
  if (!validation.valid) throw new TypeError(validation.errors.join(","));
  return Object.freeze(frame);
}

export function createAgentDirectFrame({ event, data }) {
  const frame = { event, data };
  return freezeValidFrame(frame, validateAgentDirectFrame(frame));
}

export function createAgentChannelFrame({ event, data, channelSessionId }) {
  const frame = { event, data, channelSessionId };
  return freezeValidFrame(frame, validateAgentChannelFrame(frame));
}

export function parseAgentTransportFrame(frame) {
  const validation =
    isPlainObject(frame) && Object.hasOwn(frame, "channelSessionId")
      ? validateAgentChannelFrame(frame)
      : validateAgentDirectFrame(frame);
  return freezeValidFrame({ ...frame }, validation);
}
