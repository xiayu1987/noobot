/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function clean(value) {
  return String(value || "").trim();
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
