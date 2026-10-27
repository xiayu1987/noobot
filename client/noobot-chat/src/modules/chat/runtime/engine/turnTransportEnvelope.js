/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  isEventProtocolEnvelope,
  readProtocolEventReducerInput,
  validateProtocolEvent,
} from "@noobot/event-protocol";
import {
  AGENT_TRANSPORT_NON_ENVELOPE_EVENT_KIND,
  classifyAgentTransportNonEnvelopeEvent,
  validateAgentTransportNonEnvelopePayload,
} from "@noobot/agent-transport-protocol";

const TRANSPORT_EVENT_TYPE_MISMATCH = "transport_event_type_mismatch";
const UNREGISTERED_NON_ENVELOPE_EVENT = "unregistered_non_envelope_event";

function validateTransportProtocolEnvelope(event, envelope) {
  const validation = validateProtocolEvent(envelope);
  if (!validation.valid) return validation;
  if (envelope.identity.eventType === event) return validation;
  return {
    valid: false,
    errors: [TRANSPORT_EVENT_TYPE_MISMATCH],
    descriptor: validation.descriptor,
  };
}

export function normalizeTurnTransportEnvelope({ event, data, channelSessionId }) {
  if (!isEventProtocolEnvelope(data)) {
    const nonEnvelopeKind = classifyAgentTransportNonEnvelopeEvent(event);
    if (!nonEnvelopeKind) {
      return {
        event,
        data: null,
        protocolEnvelope: null,
        family: "",
        nonEnvelopeKind: "",
        rejected: { errors: [UNREGISTERED_NON_ENVELOPE_EVENT] },
        channelSessionId,
      };
    }
    if (nonEnvelopeKind === AGENT_TRANSPORT_NON_ENVELOPE_EVENT_KIND.SESSION_RECEIPT) {
      const validation = validateAgentTransportNonEnvelopePayload(event, data);
      if (!validation.valid) {
        return {
          event,
          data: null,
          protocolEnvelope: null,
          family: "",
          nonEnvelopeKind,
          rejected: { errors: validation.errors },
          channelSessionId,
        };
      }
    }
    return {
      event,
      data,
      protocolEnvelope: null,
      family: "",
      nonEnvelopeKind,
      rejected: null,
      channelSessionId,
    };
  }
  const validation = validateTransportProtocolEnvelope(event, data);
  if (!validation.valid) {
    return {
      event,
      data: null,
      protocolEnvelope: null,
      family: "",
      nonEnvelopeKind: "",
      rejected: { errors: validation.errors },
      channelSessionId,
    };
  }
  return {
    event,
    data: readProtocolEventReducerInput(data).input,
    protocolEnvelope: data,
    family: validation.descriptor.family,
    nonEnvelopeKind: "",
    rejected: null,
    channelSessionId,
  };
}
