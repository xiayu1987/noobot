/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const SUPER_ADMIN_ROLE = "super_admin";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function resolveRuntimeFromAgentContext(agentContext = {}) {
  const context = asObject(agentContext) || {};
  return asObject(context?.execution?.controllers?.runtime) ||
    asObject(context?.runtime) ||
    {};
}

export function resolveConfiguredSuperUserId(globalConfig = {}) {
  const config = asObject(globalConfig) || {};
  return String(
    config?.superAdmin?.userId ||
      config?.super_admin?.user_id ||
      "",
  ).trim();
}

export function isSuperAdminRole(role = "") {
  return String(role || "").trim() === SUPER_ADMIN_ROLE;
}

export function isSuperUserRuntime(runtime = {}) {
  const sourceRuntime = asObject(runtime) || {};
  const systemRuntime = asObject(sourceRuntime?.systemRuntime) || {};
  if (systemRuntime?.isSuperUser === true) return true;
  if (isSuperAdminRole(sourceRuntime?.role || systemRuntime?.role)) return true;
  const configuredSuperUserId = resolveConfiguredSuperUserId(sourceRuntime?.globalConfig);
  const currentUserId = String(sourceRuntime?.userId || systemRuntime?.userId || "").trim();
  return Boolean(configuredSuperUserId && currentUserId === configuredSuperUserId);
}

export function isSuperUserAgentContext(agentContext = {}) {
  const context = asObject(agentContext) || {};
  const runtime = resolveRuntimeFromAgentContext(context);
  const systemRuntime = asObject(runtime?.systemRuntime) || {};
  if (systemRuntime?.isSuperUser === true) return true;
  if (isSuperAdminRole(
    context?.environment?.identity?.role ||
      context?.auth?.role ||
      runtime?.role ||
      systemRuntime?.role,
  )) {
    return true;
  }
  const configuredSuperUserId = resolveConfiguredSuperUserId(runtime?.globalConfig);
  const currentUserId = String(
    context?.environment?.identity?.userId ||
      runtime?.userId ||
      systemRuntime?.userId ||
      "",
  ).trim();
  return Boolean(configuredSuperUserId && currentUserId === configuredSuperUserId);
}
