/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function clean(value) {
  return String(value || "").trim();
}

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
]);

export function usesExactAgentTransportPayload(eventName) {
  return EXACT_PAYLOAD_EVENTS.has(clean(eventName));
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
    code: clean(code),
    message: String(message || "").trim(),
    occurredAt: clean(occurredAt),
    ...(clean(commandId) ? { commandId: clean(commandId) } : {}),
    identity: {
      sessionId: clean(identity.sessionId),
      turnScopeId: clean(identity.turnScopeId),
      dialogProcessId: clean(identity.dialogProcessId),
    },
  };
  const validation = validateAgentTransportError(errorEvent);
  if (!validation.valid) throw new TypeError(validation.errors.join(","));
  return Object.freeze(errorEvent);
}

export function validateAgentTransportError(errorEvent = {}) {
  const errors = [];
  if (!errorEvent || typeof errorEvent !== "object" || Array.isArray(errorEvent)) {
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
  if (!clean(errorEvent.code)) errors.push("missing_transport_error_code");
  if (!String(errorEvent.message || "").trim()) errors.push("missing_transport_error_message");
  if (
    !errorEvent.identity ||
    typeof errorEvent.identity !== "object" ||
    Array.isArray(errorEvent.identity)
  ) {
    errors.push("transport_error_identity_not_object");
  } else {
    const identityAllowed = new Set(["sessionId", "turnScopeId", "dialogProcessId"]);
    for (const key of Object.keys(errorEvent.identity)) {
      if (!identityAllowed.has(key)) errors.push(`unknown_transport_error_identity_field:${key}`);
    }
  }
  if (!clean(errorEvent.occurredAt) || Number.isNaN(Date.parse(errorEvent.occurredAt))) {
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
    commandId: clean(commandId),
    commandType: clean(commandType),
    outcome: clean(outcome).toLowerCase(),
    identity: {
      sessionId: clean(identity.sessionId),
      turnScopeId: clean(identity.turnScopeId),
      dialogProcessId: clean(identity.dialogProcessId),
    },
    occurredAt: clean(occurredAt),
    ...(error
      ? {
          error: {
            code: clean(error.code),
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
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
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
  if (!clean(receipt.commandId)) errors.push("missing_command_id");
  if (!clean(receipt.commandType)) errors.push("missing_command_type");
  if (!COMMAND_RECEIPT_OUTCOMES.has(clean(receipt.outcome).toLowerCase()))
    errors.push("invalid_outcome");
  if (
    !receipt.identity ||
    typeof receipt.identity !== "object" ||
    Array.isArray(receipt.identity)
  ) {
    errors.push("identity_not_object");
  } else {
    const identityAllowed = new Set(["sessionId", "turnScopeId", "dialogProcessId"]);
    for (const key of Object.keys(receipt.identity)) {
      if (!identityAllowed.has(key)) errors.push(`unknown_identity_field:${key}`);
    }
    if (!clean(receipt.identity.sessionId)) errors.push("missing_session_id");
  }
  if (!clean(receipt.occurredAt) || Number.isNaN(Date.parse(receipt.occurredAt))) {
    errors.push("invalid_occurred_at");
  }
  if (clean(receipt.outcome).toLowerCase() === AGENT_COMMAND_RECEIPT_OUTCOME.FAILED) {
    if (!receipt.error || typeof receipt.error !== "object" || Array.isArray(receipt.error)) {
      errors.push("missing_failure_error");
    } else if (!String(receipt.error.message || "").trim()) {
      errors.push("missing_failure_message");
    }
  } else if (receipt.error !== undefined) {
    errors.push("unexpected_error");
  }
  return { valid: errors.length === 0, errors };
}

export function createAgentTransportEvent({ event, data, channelSessionId = "" } = {}) {
  const normalizedEvent = clean(event);
  if (!normalizedEvent) throw new TypeError("missing_transport_event");
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError("invalid_transport_event_data");
  }
  const normalizedChannelSessionId = clean(channelSessionId);
  return Object.freeze({
    event: normalizedEvent,
    data,
    ...(normalizedChannelSessionId ? { channelSessionId: normalizedChannelSessionId } : {}),
  });
}

export function getAgentTransportEventSessionId(envelope = {}) {
  return clean(envelope?.channelSessionId);
}
