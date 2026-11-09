/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { TRANSPORT_TRACE_PROTOCOL_KIND } from "./constants.js";
import { EVENT_FAMILY, validateProtocolEvent } from "@noobot/event-protocol";
import { MESSAGE_EVENT_WIRE_EVENT } from "@noobot/event-protocol/message-event";
import { text } from "@noobot/shared/value";
import { readWebSocketApiKey } from "@noobot/shared/websocket-auth";

export function resolveMessageEventTrace(eventName = "", data = {}, transportSequence = 0) {
  const normalizedEventName = text(eventName);
  const validation =
    normalizedEventName === MESSAGE_EVENT_WIRE_EVENT
      ? validateProtocolEvent(data)
      : { valid: false };
  const authoritative =
    validation.valid && validation.descriptor?.family === EVENT_FAMILY.MESSAGE_TIMELINE
      ? data
      : null;
  return {
    protocolKind: authoritative
      ? TRANSPORT_TRACE_PROTOCOL_KIND.MESSAGE_EVENT
      : TRANSPORT_TRACE_PROTOCOL_KIND.NON_MESSAGE_EVENT,
    transportEvent: normalizedEventName,
    transportSequence: Number(transportSequence || 0),
    eventId: text(authoritative?.identity?.eventId),
    eventType: text(authoritative?.identity?.eventType),
    presentationMessageId: text(authoritative?.payload?.presentationMessageId),
    authoritativeSequence: Number(authoritative?.ordering?.sequence || 0),
    sessionId: text(authoritative?.identity?.sessionId),
    turnScopeId: text(authoritative?.identity?.turnScopeId),
    dialogProcessId: text(authoritative?.payload?.dialogProcessId),
  };
}

const CHANNEL_KEY_SEPARATOR = "::";
const CHANNEL_KEY_FIELDS = ["userId", "sessionId", "parentSessionId"];
const CHANNEL_KEY_REQUIRED_FIELDS = ["userId", "sessionId"];

function assertChannelKeyIdentity(identity, source) {
  for (const field of CHANNEL_KEY_REQUIRED_FIELDS) {
    if (!identity[field]) {
      throw new TypeError(`Agent-proxy channel key requires ${field}: ${source}`);
    }
  }
  return identity;
}

export function createChannelKey(identity = {}) {
  const normalized = Object.fromEntries(
    CHANNEL_KEY_FIELDS.map((field) => [field, text(identity?.[field])]),
  );
  assertChannelKeyIdentity(normalized, "createChannelKey");
  return CHANNEL_KEY_FIELDS.map((field) => normalized[field]).join(CHANNEL_KEY_SEPARATOR);
}

export function parseChannelKey(channelKey = "") {
  const parts = String(channelKey || "").split(CHANNEL_KEY_SEPARATOR);
  if (parts.length !== CHANNEL_KEY_FIELDS.length) {
    throw new TypeError(`Invalid agent-proxy channel key: ${channelKey}`);
  }
  const identity = Object.fromEntries(
    CHANNEL_KEY_FIELDS.map((field, index) => [field, parts[index].trim()]),
  );
  return Object.freeze(assertChannelKeyIdentity(identity, channelKey));
}

function parseRequestUrl(request) {
  if (typeof request?.url !== "string" || !request.url) {
    throw new TypeError("request URL required");
  }
  return new URL(request.url, "http://localhost");
}

export function parseRequestQuery(request) {
  const requestUrl = parseRequestUrl(request);
  return {
    pathname: requestUrl.pathname,
    apiKey: readWebSocketApiKey(request),
    locale: text(requestUrl.searchParams.get("locale")),
  };
}

export function parseRequestPathname(request) {
  return parseRequestUrl(request).pathname;
}

export function nowMs() {
  return Date.now();
}

export function buildFingerprint(payload = {}) {
  return JSON.stringify(payload || {});
}
