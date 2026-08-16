/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const PLUGIN_PROTOCOL_VERSION = 2;

export const PLUGIN_SURFACE = Object.freeze({
  AGENT: "agent",
  SERVICE: "service",
  FRONTEND: "frontend",
});

export const PLUGIN_ACTIVATION_STATUS = Object.freeze({
  ACTIVATED: "activated",
  DEACTIVATED: "deactivated",
  FAILED: "failed",
});

export const PLUGIN_HOST_PORT = Object.freeze({
  HOOKS_REGISTER: "hooks.register",
  HOOKS_EMIT: "hooks.emit",
  POLICY_PATCH: "policy.patch",
  MODEL_INVOKE: "model.invoke",
  ARTIFACTS_WRITE: "artifacts.write",
  EVENTS_EMIT: "events.emit",
  ROUTES_BIND: "routes.bind",
  AUTHENTICATED_REQUEST: "authenticated_request",
  FRONTEND_CONTRIBUTE: "frontend.contribute",
});

export const PLUGIN_PERMISSION = Object.freeze({
  SESSION_READ: "session.read",
  SESSION_DELETE_OBSERVE: "session.delete.observe",
  SESSION_CHILD_CREATE: "session.child.create",
  MODEL_INVOKE: "model.invoke",
  ARTIFACT_WRITE: "artifact.write",
  HTTP_AUTHENTICATED: "http.authenticated",
});

export class PluginProtocolError extends Error {
  constructor(code = "PLUGIN_PROTOCOL_ERROR", message = "plugin protocol error", details = {}) {
    super(message);
    this.name = "PluginProtocolError";
    this.code = String(code || "PLUGIN_PROTOCOL_ERROR");
    this.details = details && typeof details === "object" ? details : {};
  }
}

export function requirePluginSurface(surface = "") {
  const normalized = String(surface || "")
    .trim()
    .toLowerCase();
  if (!Object.values(PLUGIN_SURFACE).includes(normalized)) {
    throw new PluginProtocolError(
      "PLUGIN_SURFACE_INVALID",
      `unsupported plugin surface: ${normalized || "<empty>"}`,
    );
  }
  return normalized;
}

export function validatePluginActivationResult(result = {}, { pluginId = "", surface = "" } = {}) {
  const expectedPluginId = String(pluginId || "").trim();
  const expectedSurface = requirePluginSurface(surface);
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new PluginProtocolError(
      "PLUGIN_ACTIVATION_RESULT_INVALID",
      "plugin activate must return a plain object",
    );
  }
  if (Number(result.protocolVersion) !== PLUGIN_PROTOCOL_VERSION) {
    throw new PluginProtocolError(
      "PLUGIN_ACTIVATION_VERSION_INVALID",
      `plugin activation protocolVersion must equal ${PLUGIN_PROTOCOL_VERSION}`,
    );
  }
  if (String(result.pluginId || "").trim() !== expectedPluginId) {
    throw new PluginProtocolError(
      "PLUGIN_ACTIVATION_ID_MISMATCH",
      `plugin activation id mismatch: ${expectedPluginId}`,
    );
  }
  if (String(result.surface || "").trim() !== expectedSurface) {
    throw new PluginProtocolError(
      "PLUGIN_ACTIVATION_SURFACE_MISMATCH",
      `plugin activation surface mismatch: ${expectedSurface}`,
    );
  }
  if (result.dispose != null && typeof result.dispose !== "function") {
    throw new PluginProtocolError(
      "PLUGIN_ACTIVATION_DISPOSE_INVALID",
      "plugin activation dispose must be a function",
    );
  }
  return Object.freeze({
    protocolVersion: PLUGIN_PROTOCOL_VERSION,
    pluginId: expectedPluginId,
    surface: expectedSurface,
    status: PLUGIN_ACTIVATION_STATUS.ACTIVATED,
    dispose: typeof result.dispose === "function" ? result.dispose : () => {},
  });
}

export function createPluginActivationResult({ pluginId = "", surface = "", dispose = null } = {}) {
  const normalizedPluginId = String(pluginId || "").trim();
  if (!normalizedPluginId)
    throw new PluginProtocolError("PLUGIN_ID_REQUIRED", "pluginId is required");
  return validatePluginActivationResult(
    {
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      pluginId: normalizedPluginId,
      surface: requirePluginSurface(surface),
      dispose: typeof dispose === "function" ? dispose : () => {},
    },
    { pluginId: normalizedPluginId, surface },
  );
}
