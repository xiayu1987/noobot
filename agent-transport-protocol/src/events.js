/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text, isPlainObject } from "@noobot/shared/value";

export const AGENT_TRANSPORT_EVENT = Object.freeze({
  READY: "transport_ready",
  ERROR: "transport_error",
  COMMAND_RECEIPT: "transport_command_receipt",
  CHANNEL_STATE: "channel_state",
  RECONNECT_DATA: "reconnect_data",
  RECONNECT_COMPLETE: "reconnect_complete",
});

export const AGENT_TRANSPORT_ERROR_CODE = Object.freeze({
  RECONNECT_FAILED: "RECONNECT_FAILED",
});

const EXACT_PAYLOAD_EVENTS = new Set([
  AGENT_TRANSPORT_EVENT.ERROR,
  AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
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

export function createAgentCommandReceipt({
  commandId = "",
  commandType = "",
  outcome = "",
  identity = {},
  error = null,
  occurredAt = new Date().toISOString(),
} = {}) {
  const receipt = {
    protocolVersion: 1,
    commandId: text(commandId),
    commandType: text(commandType),
    outcome: text(outcome).toLowerCase(),
    identity: {
      sessionId: text(identity.sessionId),
      turnScopeId: text(identity.turnScopeId),
      dialogProcessId: text(identity.dialogProcessId),
    },
    occurredAt: text(occurredAt),
    ...(error
      ? {
          error: {
            code: text(error.code),
            message: String(error.message || ""),
          },
        }
      : {}),
  };
  const validation = validateAgentCommandReceipt(receipt);
  if (!validation.valid) throw new TypeError(validation.errors.join(","));
  return Object.freeze(receipt);
}

export function validateAgentCommandReceipt(receipt = {}) {
  const errors = [];
  if (!isPlainObject(receipt)) {
    return { valid: false, errors: ["receipt_not_object"] };
  }
  const allowed = new Set([
    "protocolVersion",
    "commandId",
    "commandType",
    "outcome",
    "identity",
    "occurredAt",
    "error",
  ]);
  for (const key of Object.keys(receipt)) {
    if (!allowed.has(key)) errors.push(`unknown_receipt_field:${key}`);
  }
  if (Number(receipt.protocolVersion) !== 1) errors.push("unsupported_receipt_version");
  if (!text(receipt.commandId)) errors.push("missing_command_id");
  if (!text(receipt.commandType)) errors.push("missing_command_type");
  if (!COMMAND_RECEIPT_OUTCOMES.has(text(receipt.outcome).toLowerCase()))
    errors.push("invalid_outcome");
  if (!isPlainObject(receipt.identity)) {
    errors.push("identity_not_object");
  } else {
    const identityAllowed = new Set(["sessionId", "turnScopeId", "dialogProcessId"]);
    for (const key of Object.keys(receipt.identity)) {
      if (!identityAllowed.has(key)) errors.push(`unknown_identity_field:${key}`);
    }
    if (!text(receipt.identity.sessionId)) errors.push("missing_session_id");
  }
  if (!text(receipt.occurredAt) || Number.isNaN(Date.parse(receipt.occurredAt))) {
    errors.push("invalid_occurred_at");
  }
  if (text(receipt.outcome).toLowerCase() === AGENT_COMMAND_RECEIPT_OUTCOME.FAILED) {
    if (!isPlainObject(receipt.error)) {
      errors.push("missing_failure_error");
    } else if (!text(receipt.error.message)) {
      errors.push("missing_failure_message");
    }
  } else if (receipt.error !== undefined) {
    errors.push("unexpected_error");
  }
  return { valid: errors.length === 0, errors };
}

export function createAgentTransportEvent({ event, data, channelSessionId = "" } = {}) {
  const normalizedEvent = text(event);
  if (!normalizedEvent) throw new TypeError("missing_transport_event");
  if (!isPlainObject(data)) {
    throw new TypeError("invalid_transport_event_data");
  }
  const normalizedChannelSessionId = text(channelSessionId);
  return Object.freeze({
    event: normalizedEvent,
    data,
    ...(normalizedChannelSessionId ? { channelSessionId: normalizedChannelSessionId } : {}),
  });
}

export function getAgentTransportEventSessionId(envelope = {}) {
  return text(envelope?.channelSessionId);
}
