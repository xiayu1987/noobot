/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  hasAgentTransportNonEnvelopePayloadContract,
  validateAgentTransportNonEnvelopePayload,
} from "@noobot/agent-transport-protocol";
import { validateProtocolEvent } from "@noobot/event-protocol";
import { text } from "@noobot/shared/value";

export function validateDataPlaneEvent(eventName, data) {
  const normalizedEventName = text(eventName);
  if (hasAgentTransportNonEnvelopePayloadContract(normalizedEventName)) {
    return validateAgentTransportNonEnvelopePayload(normalizedEventName, data);
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
