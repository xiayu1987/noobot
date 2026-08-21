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

const SESSION_RECEIPT_VALIDATORS = new Map([
  [TURN_COMMITTED_WIRE_EVENT, validateTurnCommittedEventData],
  [TURN_ATTACHMENTS_BOUND_WIRE_EVENT, validateTurnAttachmentsBoundEventData],
]);

export function validateDataPlaneEvent(eventName, data) {
  const normalizedEventName = String(eventName || "").trim();
  if (normalizedEventName === AGENT_TRANSPORT_EVENT.ERROR) {
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
  if (String(data?.identity?.eventType || "").trim() !== normalizedEventName) {
    return { valid: false, errors: ["wire_event_identity_mismatch"] };
  }
  return validation;
}

export function assertDataPlaneEvent(eventName, data) {
  const validation = validateDataPlaneEvent(eventName, data);
  if (!validation.valid) throw new TypeError(validation.errors.join(","));
}
