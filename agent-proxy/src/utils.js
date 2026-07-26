/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { randomUUID } from "node:crypto";
import { CHANNEL_TERMINAL_STATUSES, CLIENT_ROLE } from "./constants.js";
import { isMessageEventEnvelope } from "../../shared/message-event-protocol.mjs";

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
  const candidate = normalizedEventName === "message_event" || normalizedEventName === "subagent_message_event"
    ? data?.event
    : null;
  const authoritative = isMessageEventEnvelope(candidate) ? candidate : null;
  return {
    protocolKind: authoritative ? "message_event" : "legacy",
    transportEvent: normalizedEventName,
    transportSequence: Number(transportSequence || 0),
    eventId: String(authoritative?.eventId || "").trim(),
    eventType: String(authoritative?.eventType || "").trim(),
    messageId: String(authoritative?.messageId || "").trim(),
    authoritativeSequence: Number(authoritative?.sequence || 0),
    sessionId: String(authoritative?.sessionId || data?.sessionId || "").trim(),
    turnScopeId: String(authoritative?.turnScopeId || data?.turnScopeId || "").trim(),
    dialogProcessId: String(authoritative?.dialogProcessId || data?.dialogProcessId || "").trim(),
  };
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
