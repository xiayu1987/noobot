/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const MODEL_NAME_HEADER_KEY = "X-Model-Name";
export const PARENT_SESSION_HEADER_KEY = "parentSessionid";

export const PLUGIN_MODEL_HEADER_KEY = Object.freeze({
  FLOW: "X-Plugin-Flow",
  PURPOSE: "X-Plugin-Purpose",
  DOMAIN: "X-Plugin-Domain",
  SESSION_ID: "X-Plugin-Session-Id",
});

export function buildPluginModelHeaders({
  flow = "",
  purpose = "",
  domain = "",
  sessionId = "",
} = {}) {
  const normalizedFlow = String(flow || "").trim();
  const normalizedPurpose = String(purpose || "").trim();
  const normalizedDomain = String(domain || "").trim();
  const normalizedSessionId = String(sessionId || "").trim();
  return {
    ...(normalizedFlow ? { [PLUGIN_MODEL_HEADER_KEY.FLOW]: normalizedFlow } : {}),
    ...(normalizedPurpose ? { [PLUGIN_MODEL_HEADER_KEY.PURPOSE]: normalizedPurpose } : {}),
    ...(normalizedDomain ? { [PLUGIN_MODEL_HEADER_KEY.DOMAIN]: normalizedDomain } : {}),
    ...(normalizedSessionId ? { [PLUGIN_MODEL_HEADER_KEY.SESSION_ID]: normalizedSessionId } : {}),
  };
}
