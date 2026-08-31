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

export const PLUGIN_LIFECYCLE_EVENT = Object.freeze({
  DISCOVERED: "plugin.discovered",
  MANIFEST_VALIDATED: "plugin.manifest_validated",
  MODULE_LOADED: "plugin.module_loaded",
  ACTIVATING: "plugin.activating",
  ACTIVATED: "plugin.activated",
  CONTRIBUTION_COMMITTED: "plugin.contribution_committed",
  DEACTIVATING: "plugin.deactivating",
  DEACTIVATED: "plugin.deactivated",
  FAILED: "plugin.failed",
  ROLLED_BACK: "plugin.rolled_back",
});

export const PLUGIN_HOST_PORT = Object.freeze({
  HOOKS_REGISTER: "hooks.register",
  HOOKS_EMIT: "hooks.emit",
  POLICY_PATCH: "policy.patch",
  MODEL_INVOKE: "model.invoke",
  ARTIFACTS_COMMIT: "artifacts.commit",
  ARTIFACTS_GET: "artifacts.get",
  TOOLS_REGISTER: "tools.register",
  ROUTES_BIND: "routes.bind",
  AUTHENTICATED_REQUEST: "authenticated_request",
  FRONTEND_CONTRIBUTE: "frontend.contribute",
  SERVICE_SESSIONS_READ: "service.sessions.read",
  SERVICE_WORKSPACE_ASSETS: "service.workspace.assets",
  SERVICE_HTTP_STATUS: "service.http.status",
});

export const PLUGIN_PERMISSION = Object.freeze({
  SESSION_READ: "session.read",
  SESSION_DELETE_OBSERVE: "session.delete.observe",
  SESSION_CHILD_CREATE: "session.child.create",
  MODEL_INVOKE: "model.invoke",
  ARTIFACT_COMMIT: "artifact.commit",
  ARTIFACT_READ: "artifact.read",
  HTTP_AUTHENTICATED: "http.authenticated",
  WORKSPACE_ASSET_MANAGE: "workspace.asset.manage",
});

export const PLUGIN_PORT_PERMISSION_REQUIREMENTS = Object.freeze({
  [PLUGIN_HOST_PORT.MODEL_INVOKE]: Object.freeze([PLUGIN_PERMISSION.MODEL_INVOKE]),
  [PLUGIN_HOST_PORT.ARTIFACTS_COMMIT]: Object.freeze([PLUGIN_PERMISSION.ARTIFACT_COMMIT]),
  [PLUGIN_HOST_PORT.ARTIFACTS_GET]: Object.freeze([PLUGIN_PERMISSION.ARTIFACT_READ]),
  [PLUGIN_HOST_PORT.AUTHENTICATED_REQUEST]: Object.freeze([PLUGIN_PERMISSION.HTTP_AUTHENTICATED]),
  [PLUGIN_HOST_PORT.SERVICE_SESSIONS_READ]: Object.freeze([PLUGIN_PERMISSION.SESSION_READ]),
  [PLUGIN_HOST_PORT.SERVICE_WORKSPACE_ASSETS]: Object.freeze([
    PLUGIN_PERMISSION.WORKSPACE_ASSET_MANAGE,
  ]),
});

export const PLUGIN_SURFACE_HOST_PORTS = Object.freeze({
  [PLUGIN_SURFACE.AGENT]: Object.freeze([
    PLUGIN_HOST_PORT.HOOKS_REGISTER,
    PLUGIN_HOST_PORT.HOOKS_EMIT,
    PLUGIN_HOST_PORT.POLICY_PATCH,
    PLUGIN_HOST_PORT.MODEL_INVOKE,
    PLUGIN_HOST_PORT.ARTIFACTS_COMMIT,
    PLUGIN_HOST_PORT.ARTIFACTS_GET,
    PLUGIN_HOST_PORT.TOOLS_REGISTER,
  ]),
  [PLUGIN_SURFACE.SERVICE]: Object.freeze([
    PLUGIN_HOST_PORT.HOOKS_REGISTER,
    PLUGIN_HOST_PORT.HOOKS_EMIT,
    PLUGIN_HOST_PORT.ROUTES_BIND,
    PLUGIN_HOST_PORT.SERVICE_SESSIONS_READ,
    PLUGIN_HOST_PORT.SERVICE_WORKSPACE_ASSETS,
    PLUGIN_HOST_PORT.SERVICE_HTTP_STATUS,
  ]),
  [PLUGIN_SURFACE.FRONTEND]: Object.freeze([
    PLUGIN_HOST_PORT.AUTHENTICATED_REQUEST,
    PLUGIN_HOST_PORT.FRONTEND_CONTRIBUTE,
  ]),
});

export function portsForPluginSurface(manifest = {}, surface = "") {
  const normalizedSurface = requirePluginSurface(surface);
  const allowed = new Set(PLUGIN_SURFACE_HOST_PORTS[normalizedSurface]);
  return Object.freeze(
    (Array.isArray(manifest?.requires?.ports) ? manifest.requires.ports : []).filter((port) =>
      allowed.has(port),
    ),
  );
}

export function createPluginContributionIdentity({
  pluginId = "",
  surface = "",
  localId = "",
} = {}) {
  const normalizedPluginId = String(pluginId || "").trim();
  const normalizedLocalId = String(localId || "").trim();
  if (!normalizedPluginId)
    throw new PluginProtocolError("PLUGIN_ID_REQUIRED", "pluginId is required");
  if (!normalizedLocalId)
    throw new PluginProtocolError("PLUGIN_CONTRIBUTION_ID_REQUIRED", "localId is required");
  return Object.freeze({
    pluginId: normalizedPluginId,
    surface: requirePluginSurface(surface),
    localId: normalizedLocalId,
  });
}

export function serializePluginContributionIdentity(identity = {}) {
  const normalized = createPluginContributionIdentity(identity);
  return `${normalized.pluginId}:${normalized.localId}`;
}

export function createPluginLifecycleRecord({
  event = "",
  entry = null,
  error = null,
  details = {},
} = {}) {
  const normalizedEvent = String(event || "").trim();
  if (!Object.values(PLUGIN_LIFECYCLE_EVENT).includes(normalizedEvent)) {
    throw new PluginProtocolError(
      "PLUGIN_LIFECYCLE_EVENT_INVALID",
      `unsupported plugin lifecycle event: ${normalizedEvent || "<empty>"}`,
    );
  }
  const record = {
    event: normalizedEvent,
    pluginId: String(entry?.pluginId || entry?.manifest?.id || "").trim(),
    pluginVersion: String(entry?.manifest?.version || "").trim(),
    protocolVersion: Number(entry?.manifest?.protocolVersion || PLUGIN_PROTOCOL_VERSION),
    surface: requirePluginSurface(entry?.surface),
    ...(details && typeof details === "object" ? details : {}),
  };
  if (!record.pluginId)
    throw new PluginProtocolError("PLUGIN_ID_REQUIRED", "plugin lifecycle entry id is required");
  if (error) {
    record.errorCode = String(error?.code || "PLUGIN_ACTIVATION_FAILED");
    record.message = String(error?.message || error);
  }
  return Object.freeze(record);
}

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
