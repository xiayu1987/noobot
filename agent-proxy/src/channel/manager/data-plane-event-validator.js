/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  AGENT_TRANSPORT_EVENT,
  validateAgentCommandReceipt,
  validateAgentTransportError,
} from "@noobot/agent-transport-protocol";
import { validateProtocolEvent } from "@noobot/event-protocol";
import {
  TURN_ATTACHMENTS_BOUND_WIRE_EVENT,
  validateTurnAttachmentsBoundEventData,
} from "@noobot/session-protocol/turn-attachment-bind";
import {
  TURN_COMMITTED_WIRE_EVENT,
  validateTurnCommittedEventData,
} from "@noobot/session-protocol/turn-commit";
import { text } from "@noobot/shared/value";

const SESSION_RECEIPT_VALIDATORS = new Map([
  [TURN_COMMITTED_WIRE_EVENT, validateTurnCommittedEventData],
  [TURN_ATTACHMENTS_BOUND_WIRE_EVENT, validateTurnAttachmentsBoundEventData],
]);

export function validateDataPlaneEvent(eventName, data) {
  const normalizedEventName = text(eventName);
  if (normalizedEventName === AGENT_TRANSPORT_EVENT.CHANNEL_ERROR) {
    return validateAgentTransportError(data);
  }
  if (normalizedEventName === AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT) {
    return validateAgentCommandReceipt(data);
  }
  const sessionReceiptValidator = SESSION_RECEIPT_VALIDATORS.get(normalizedEventName);
  if (sessionReceiptValidator) {
    const validation = sessionReceiptValidator(data);
    return { valid: validation.ok, errors: validation.errors };
  }
  const validation = validateProtocolEvent(data);
  if (!validation.valid) return validation;
  if (text(data?.identity?.eventType) !== normalizedEventName) {
    return { valid: false, errors: ["wire_event_identity_mismatch"] };
  }
  return validation;
}

function wireString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function locateDataPlaneFrame(eventName, data) {
  const eventId = wireString(data?.identity?.eventId);
  const commandId = wireString(data?.commandId) || wireString(data?.causality?.commandId);
  if (!eventId && !commandId) return null;
  return {
    eventName: wireString(eventName),
    eventId,
    commandId,
    runId: wireString(data?.identity?.runId),
  };
}

export function assertLocatableDataPlaneEvent(eventName, data) {
  const validation = validateDataPlaneEvent(eventName, data);
  if (validation.valid) return;
  const error = new TypeError(validation.errors.join(","));
  const frameLocator = locateDataPlaneFrame(eventName, data);
  if (frameLocator) error.frameLocator = frameLocator;
  throw error;
}
