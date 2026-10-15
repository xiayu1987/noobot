/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { randomUUID } from "node:crypto";
import { CLIENT_ROLE, TRANSPORT_TRACE_PROTOCOL_KIND } from "./constants.js";
import { EVENT_FAMILY, validateProtocolEvent } from "@noobot/event-protocol";
import { MESSAGE_EVENT_WIRE_EVENT } from "@noobot/event-protocol/message-event";
import { text } from "@noobot/shared/value";

export function ensureConnectionId(socket = null) {
  if (!socket) return "";
  const existing = text(socket.__agentProxyConnectionId);
  if (existing) return existing;
  const connectionId = randomUUID();
  socket.__agentProxyConnectionId = connectionId;
  return connectionId;
}

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
    messageId: text(authoritative?.identity?.messageId),
    authoritativeSequence: Number(authoritative?.ordering?.sequence || 0),
    sessionId: text(authoritative?.identity?.sessionId),
    turnScopeId: text(authoritative?.identity?.turnScopeId),
    dialogProcessId: text(authoritative?.payload?.dialogProcessId),
  };
}

export function normalizeApiKey(input = "") {
  return text(input);
}

const CHANNEL_KEY_SEPARATOR = "::";
const CHANNEL_KEY_FIELDS = ["userId", "sessionId", "parentSessionId", "parentDialogProcessId"];
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

export function parseRequestQuery(request = null) {
  try {
    const requestUrl = new URL(request?.url || "", "http://localhost");
    return {
      pathname: text(requestUrl.pathname),
      apiKey: text(requestUrl.searchParams.get("apikey")),
      locale: text(requestUrl.searchParams.get("locale")),
    };
  } catch {
    return { pathname: "", apiKey: "", locale: "" };
  }
}

export function parseRequestPathname(request = null) {
  try {
    const requestUrl = new URL(request?.url || "", "http://localhost");
    return text(requestUrl.pathname);
  } catch {
    return "";
  }
}

export function buildClientPermissions(role = CLIENT_ROLE.USER) {
  const normalizedRole = text(role) || CLIENT_ROLE.USER || CLIENT_ROLE.USER;
  const isSuperAdmin = normalizedRole === CLIENT_ROLE.SUPER_ADMIN;
  return {
    role: normalizedRole,
    canChat: true,
    canUseAgentProxy: true,
    canAccessWorkspace: true,
    canAccessAdmin: isSuperAdmin,
    canManageUsers: isSuperAdmin,
    canManageTemplate: isSuperAdmin,
    canManageSystemConfigParams: isSuperAdmin,
  };
}

export function nowMs() {
  return Date.now();
}

export function buildFingerprint(payload = {}) {
  return JSON.stringify(payload || {});
}

export function buildUpstreamUrl(baseUrl = "", apiKey = "") {
  const normalizedBaseUrl = text(baseUrl);
  const normalizedApiKey = text(apiKey);
  if (!normalizedBaseUrl) return "";
  if (!normalizedApiKey) return normalizedBaseUrl;
  const upstreamUrl = new URL(normalizedBaseUrl);
  upstreamUrl.searchParams.set("apikey", normalizedApiKey);
  return upstreamUrl.toString();
}
