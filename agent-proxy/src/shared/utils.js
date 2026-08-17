/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { randomUUID } from "node:crypto";
import { CHANNEL_TERMINAL_STATUSES, CLIENT_ROLE } from "./constants.js";
import { EVENT_FAMILY, validateProtocolEvent } from "@noobot/event-protocol";
import { MESSAGE_EVENT_WIRE_EVENT } from "@noobot/event-protocol/message-event";

export function ensureConnectionId(socket = null) {
  if (!socket) return "";
  const existing = String(socket.__agentProxyConnectionId || "").trim();
  if (existing) return existing;
  const connectionId = randomUUID();
  socket.__agentProxyConnectionId = connectionId;
  return connectionId;
}

export function resolveMessageEventTrace(eventName = "", data = {}, transportSequence = 0) {
  const normalizedEventName = String(eventName || "").trim();
  const validation = normalizedEventName === MESSAGE_EVENT_WIRE_EVENT
    ? validateProtocolEvent(data)
    : { valid: false };
  const authoritative = validation.valid && validation.descriptor?.family === EVENT_FAMILY.MESSAGE_TIMELINE
    ? data
    : null;
  return {
    protocolKind: authoritative ? "message_event" : "non_message_event",
    transportEvent: normalizedEventName,
    transportSequence: Number(transportSequence || 0),
    eventId: String(authoritative?.identity?.eventId || "").trim(),
    eventType: String(authoritative?.identity?.eventType || "").trim(),
    messageId: String(authoritative?.identity?.messageId || "").trim(),
    authoritativeSequence: Number(authoritative?.ordering?.sequence || 0),
    sessionId: String(authoritative?.identity?.sessionId || "").trim(),
    turnScopeId: String(authoritative?.identity?.turnScopeId || "").trim(),
    dialogProcessId: String(authoritative?.payload?.dialogProcessId || "").trim(),
  };
}

export function messageEventHasContent(eventName = "", data = {}) {
  const normalizedEventName = String(eventName || "").trim();
  if (normalizedEventName !== MESSAGE_EVENT_WIRE_EVENT) return false;
  const validation = validateProtocolEvent(data);
  if (!validation.valid || validation.descriptor?.family !== EVENT_FAMILY.MESSAGE_TIMELINE) return false;
  const payload = data.payload;
  return Boolean(
    payload?.content || payload?.text ||
    payload?.delta?.content || payload?.delta?.text,
  );
}

export function normalizeApiKey(input = "") {
  return String(input || "").trim();
}

export function createChannelKey({
  userId = "",
  sessionId = "",
  parentSessionId = "",
  parentDialogProcessId = "",
} = {}) {
  return [
    String(userId || "").trim(),
    String(sessionId || "").trim(),
    String(parentSessionId || "").trim(),
    String(parentDialogProcessId || "").trim(),
  ].join("::");
}

export function parseRequestQuery(request = null) {
  try {
    const requestUrl = new URL(request?.url || "", "http://localhost");
    return {
      pathname: String(requestUrl.pathname || "").trim(),
      apiKey: String(requestUrl.searchParams.get("apikey") || "").trim(),
      locale: String(requestUrl.searchParams.get("locale") || "").trim(),
    };
  } catch {
    return { pathname: "", apiKey: "", locale: "" };
  }
}

export function parseRequestPathname(request = null) {
  try {
    const requestUrl = new URL(request?.url || "", "http://localhost");
    return String(requestUrl.pathname || "").trim();
  } catch {
    return "";
  }
}

export function buildClientPermissions(role = CLIENT_ROLE.USER) {
  const normalizedRole =
    String(role || CLIENT_ROLE.USER).trim() || CLIENT_ROLE.USER;
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

export function isTerminalStatus(status = "") {
  return CHANNEL_TERMINAL_STATUSES.includes(String(status || "").trim());
}

export function buildFingerprint(payload = {}) {
  return JSON.stringify(payload || {});
}

export function buildUpstreamUrl(baseUrl = "", apiKey = "") {
  const normalizedBaseUrl = String(baseUrl || "").trim();
  const normalizedApiKey = String(apiKey || "").trim();
  if (!normalizedBaseUrl) return "";
  if (!normalizedApiKey) return normalizedBaseUrl;
  const upstreamUrl = new URL(normalizedBaseUrl);
  upstreamUrl.searchParams.set("apikey", normalizedApiKey);
  return upstreamUrl.toString();
}
