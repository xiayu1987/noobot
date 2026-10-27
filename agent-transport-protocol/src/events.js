/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text, isPlainObject, isCanonicalText } from "@noobot/shared/value";
import { TURN_SNAPSHOT_WIRE_EVENT } from "@noobot/session-protocol";
import { EXECUTION_QUERY_CONTRACT } from "@noobot/session-protocol/execution-lifecycle";
import {
  TURN_ATTACHMENTS_BOUND_WIRE_EVENT,
  validateTurnAttachmentsBoundEventData,
} from "@noobot/session-protocol/turn-attachment-bind";
import {
  TURN_COMMITTED_WIRE_EVENT,
  validateTurnCommittedEventData,
} from "@noobot/session-protocol/turn-commit";

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
  ROUTE_FAILED: "ROUTE_FAILED",
  INVALID_JSON_PAYLOAD: "INVALID_JSON_PAYLOAD",
  INVALID_AGENT_COMMAND: "INVALID_AGENT_COMMAND",
  UNSUPPORTED_ACTION: "UNSUPPORTED_ACTION",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  UPSTREAM_UNAVAILABLE: "UPSTREAM_UNAVAILABLE",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  UPSTREAM_URL_EMPTY: "UPSTREAM_URL_EMPTY",
  FAILED_TO_SEND_PAYLOAD: "FAILED_TO_SEND_PAYLOAD",
  UPSTREAM_WEBSOCKET_ERROR: "UPSTREAM_WEBSOCKET_ERROR",
  INVALID_UPSTREAM_EVENT: "INVALID_UPSTREAM_EVENT",
});

const TRANSPORT_ERROR_CODES = new Set(Object.values(AGENT_TRANSPORT_ERROR_CODE));
const TRANSPORT_ERROR_FIELDS = new Set([
  "protocolVersion",
  "code",
  "message",
  "identity",
  "occurredAt",
]);

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

const TERMINAL_CHANNEL_STATES = new Set([
  AGENT_CHANNEL_STATE.NO_CONVERSATION,
  AGENT_CHANNEL_STATE.COMPLETED,
  AGENT_CHANNEL_STATE.USER_STOPPED,
  AGENT_CHANNEL_STATE.ERROR,
  AGENT_CHANNEL_STATE.EXPIRED,
]);

const IN_FLIGHT_CHANNEL_STATES = new Set([
  AGENT_CHANNEL_STATE.SENDING,
  AGENT_CHANNEL_STATE.INTERACTION_PENDING,
  AGENT_CHANNEL_STATE.STOPPING,
  AGENT_CHANNEL_STATE.RECONNECTING,
]);

export function isTerminalAgentChannelState(state) {
  return TERMINAL_CHANNEL_STATES.has(state);
}

export function isInFlightAgentChannelState(state) {
  return IN_FLIGHT_CHANNEL_STATES.has(state);
}

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

export function validateAgentChannelState(channelState) {
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

export function createAgentTransportError({ code, message, identity, occurredAt }) {
  return freezeValid(
    {
      protocolVersion: 1,
      code,
      message,
      identity: projectCommandResultIdentity(identity),
      occurredAt,
    },
    validateAgentTransportError,
  );
}

export function validateAgentTransportError(errorEvent) {
  if (!isPlainObject(errorEvent)) {
    return { valid: false, errors: ["transport_error_not_object"] };
  }
  const errors = [];
  collectUnknownFields(errorEvent, TRANSPORT_ERROR_FIELDS, "unknown_transport_error_field", errors);
  if (errorEvent.protocolVersion !== 1) errors.push("unsupported_transport_error_version");
  if (!TRANSPORT_ERROR_CODES.has(errorEvent.code)) errors.push("invalid_transport_error_code");
  if (!isCanonicalText(errorEvent.message)) errors.push("missing_transport_error_message");
  validateCommandResultIdentity(errorEvent.identity, "transport_error", errors);
  if (!isCanonicalText(errorEvent.occurredAt) || Number.isNaN(Date.parse(errorEvent.occurredAt))) {
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

function validateCommandResultIdentity(identity, prefix, errors) {
  if (!isPlainObject(identity)) {
    errors.push(`${prefix}_identity_not_object`);
    return false;
  }
  collectUnknownFields(
    identity,
    COMMAND_RESULT_IDENTITY_FIELDS,
    `unknown_${prefix}_identity_field`,
    errors,
  );
  for (const key of Object.keys(identity)) {
    if (!isCanonicalText(identity[key])) errors.push(`invalid_${prefix}_identity_field:${key}`);
  }
  return true;
}

function validateCommandResultCommon(result, prefix, errors) {
  if (result.protocolVersion !== 1) errors.push(`unsupported_${prefix}_version`);
  if (!isCanonicalText(result.commandId)) errors.push("missing_command_id");
  if (!isCanonicalText(result.commandType)) errors.push("missing_command_type");
  if (
    validateCommandResultIdentity(result.identity, prefix, errors) &&
    !isCanonicalText(result.identity.sessionId)
  ) {
    errors.push("missing_session_id");
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

const EXACT_PAYLOAD_VALIDATORS = new Map([
  [AGENT_TRANSPORT_EVENT.ERROR, validateAgentTransportError],
  [AGENT_TRANSPORT_EVENT.CHANNEL_ERROR, validateAgentTransportError],
  [AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT, validateAgentCommandReceipt],
  [AGENT_TRANSPORT_EVENT.COMMAND_REJECTED, validateAgentCommandRejection],
  [AGENT_TRANSPORT_EVENT.CHANNEL_STATE, validateAgentChannelState],
]);

export function validateAgentTransportPayload(eventName, data) {
  const validator = EXACT_PAYLOAD_VALIDATORS.get(eventName);
  if (!validator) throw new TypeError(`no transport payload contract: ${eventName}`);
  return validator(data);
}

export const AGENT_TRANSPORT_NON_ENVELOPE_EVENT_KIND = Object.freeze({
  EXACT_PAYLOAD: "exact_payload",
  DIRECT_CONTROL: "direct_control",
  SESSION_RECEIPT: "session_receipt",
});

const NON_ENVELOPE_EVENT_KINDS = new Map([
  ...[...EXACT_PAYLOAD_VALIDATORS.keys()].map((eventName) => [
    eventName,
    AGENT_TRANSPORT_NON_ENVELOPE_EVENT_KIND.EXACT_PAYLOAD,
  ]),
  [AGENT_TRANSPORT_EVENT.READY, AGENT_TRANSPORT_NON_ENVELOPE_EVENT_KIND.DIRECT_CONTROL],
  [AGENT_TRANSPORT_EVENT.RECONNECT_DATA, AGENT_TRANSPORT_NON_ENVELOPE_EVENT_KIND.DIRECT_CONTROL],
  [
    AGENT_TRANSPORT_EVENT.RECONNECT_COMPLETE,
    AGENT_TRANSPORT_NON_ENVELOPE_EVENT_KIND.DIRECT_CONTROL,
  ],
  [TURN_COMMITTED_WIRE_EVENT, AGENT_TRANSPORT_NON_ENVELOPE_EVENT_KIND.SESSION_RECEIPT],
  [TURN_ATTACHMENTS_BOUND_WIRE_EVENT, AGENT_TRANSPORT_NON_ENVELOPE_EVENT_KIND.SESSION_RECEIPT],
]);

export function classifyAgentTransportNonEnvelopeEvent(eventName) {
  return NON_ENVELOPE_EVENT_KINDS.get(eventName) ?? "";
}

const NON_ENVELOPE_PAYLOAD_VALIDATORS = new Map([
  ...EXACT_PAYLOAD_VALIDATORS,
  [TURN_COMMITTED_WIRE_EVENT, validateTurnCommittedEventData],
  [TURN_ATTACHMENTS_BOUND_WIRE_EVENT, validateTurnAttachmentsBoundEventData],
]);

export function hasAgentTransportNonEnvelopePayloadContract(eventName) {
  return NON_ENVELOPE_PAYLOAD_VALIDATORS.has(eventName);
}

export function validateAgentTransportNonEnvelopePayload(eventName, data) {
  const validator = NON_ENVELOPE_PAYLOAD_VALIDATORS.get(eventName);
  if (!validator) throw new TypeError(`no non-envelope payload contract: ${eventName}`);
  return validator(data);
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
  if (!isPlainObject(frame.data)) {
    errors.push("invalid_transport_event_data");
    return errors;
  }
  const payloadValidator = EXACT_PAYLOAD_VALIDATORS.get(frame.event);
  if (payloadValidator) errors.push(...payloadValidator(frame.data).errors);
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
