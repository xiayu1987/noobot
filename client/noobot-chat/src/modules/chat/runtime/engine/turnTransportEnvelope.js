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

const TRANSPORT_EVENT_TYPE_MISMATCH = "transport_event_type_mismatch";

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
    return { event, data, protocolEnvelope: null, family: "", rejected: null, channelSessionId };
  }
  const validation = validateTransportProtocolEnvelope(event, data);
  if (!validation.valid) {
    return {
      event,
      data: null,
      protocolEnvelope: null,
      family: "",
      rejected: { errors: validation.errors },
      channelSessionId,
    };
  }
  return {
    event,
    data: readProtocolEventReducerInput(data).input,
    protocolEnvelope: data,
    family: validation.descriptor.family,
    rejected: null,
    channelSessionId,
  };
}
