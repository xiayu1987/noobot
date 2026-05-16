/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { CHANNEL_TERMINAL_STATUSES, CLIENT_ROLE } from "./constants.js";

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
