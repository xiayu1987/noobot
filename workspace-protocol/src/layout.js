/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const WORKSPACE_LAYOUT_VERSION = 15;

export const WORKSPACE_ROOT_LAYOUT = Object.freeze({
  USERS_FILE: "user.json",
  CONFIG_PARAMS_FILE: "config-params.json",
});

export const WORKSPACE_LAYOUT = Object.freeze({
  CONFIG_FILE: "config.json",
  CONFIG_PARAMS_FILE: "config-params.json",
  RETIRED_CONFIG_EXAMPLE_FILE: "config.example.json",
  MEMORY_DIR: "memory",
  SERVICES_DIR: "services",
  SKILLS_DIR: "skills",
  RUNTIME_DIR: "runtime",
  SESSION_DIR: "runtime/session",
  SESSION_TREE_FILE: "runtime/session/session-tree.json",
  SESSION_SUMMARY_FILE: "runtime/session/sessions.json",
  SESSION_TOMBSTONE_FILE: "runtime/session/.deleted-sessions.json",
  RETIRED_SESSION_LIFECYCLE_RECORDS_DIR: "runtime/session/.lifecycle/records",
  SESSION_LIFECYCLE_LOCKS_DIR: "runtime/session/.lifecycle/locks",
  ATTACH_DIR: "runtime/attach",
  SCOPED_ATTACH_DIR: "runtime/attach/scoped",
  CONNECTORS_DIR: "runtime/connectors",
  OPS_WORKDIR: "runtime/ops_workdir",
  SUBAGENT_DIR: "runtime/subagent",
  AGENT_SESSION_DIR: "runtime/agent/session",
  NATIVE_TASKS_DIR: "runtime/native_tasks",
  BROWSER_PROFILES_DIR: "runtime/browser-profiles",
  PLUGIN_ASSETS_DIR: "runtime/plugin-assets",
  PLUGIN_DATA_DIR: "runtime/plugin-data",
  MEMORY_REPAIR_BACKUPS_DIR: "runtime/memory-repair-backups",
  WORKSPACE_BACKUPS_DIR: "runtime/workspace-backups",
  MIGRATION_QUARANTINE_DIR: "runtime/migration-quarantine",
  ASSET_STATE_FILE: "runtime/workspace-asset-state.json",
  LAYOUT_STATE_FILE: "runtime/workspace-layout-state.json",
});

export const WORKSPACE_RUNTIME_DIRECTORIES = Object.freeze([
  WORKSPACE_LAYOUT.SESSION_DIR,
  WORKSPACE_LAYOUT.SESSION_LIFECYCLE_LOCKS_DIR,
  WORKSPACE_LAYOUT.SCOPED_ATTACH_DIR,
  WORKSPACE_LAYOUT.CONNECTORS_DIR,
  WORKSPACE_LAYOUT.OPS_WORKDIR,
  WORKSPACE_LAYOUT.SUBAGENT_DIR,
  WORKSPACE_LAYOUT.AGENT_SESSION_DIR,
  WORKSPACE_LAYOUT.NATIVE_TASKS_DIR,
  WORKSPACE_LAYOUT.BROWSER_PROFILES_DIR,
  WORKSPACE_LAYOUT.PLUGIN_ASSETS_DIR,
  WORKSPACE_LAYOUT.PLUGIN_DATA_DIR,
]);

export const WORKSPACE_USER_CONFIGURATION_ENTRIES = Object.freeze([
  WORKSPACE_LAYOUT.CONFIG_FILE,
  WORKSPACE_LAYOUT.CONFIG_PARAMS_FILE,
  WORKSPACE_LAYOUT.MEMORY_DIR,
  WORKSPACE_LAYOUT.SERVICES_DIR,
  WORKSPACE_LAYOUT.SKILLS_DIR,
]);

export const WORKSPACE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/;

export function isWorkspacePathSegment(value) {
  const segment = String(value ?? "");
  return WORKSPACE_PATH_SEGMENT_PATTERN.test(segment) && !segment.includes("..");
}

function requireSegment(value, label) {
  const segment = String(value ?? "").trim();
  if (!isWorkspacePathSegment(segment)) {
    throw new TypeError(`invalid workspace ${label}: ${segment}`);
  }
  return segment;
}

function joinRelative(root, pluginId, segments) {
  const parts = [root, requireSegment(pluginId, "plugin id")];
  for (const segment of segments) parts.push(requireSegment(segment, "path segment"));
  return parts.join("/");
}

export function resolvePluginAssetsRelativePath(pluginId, ...segments) {
  return joinRelative(WORKSPACE_LAYOUT.PLUGIN_ASSETS_DIR, pluginId, segments);
}

export function resolvePluginDataRelativePath(pluginId, ...segments) {
  return joinRelative(WORKSPACE_LAYOUT.PLUGIN_DATA_DIR, pluginId, segments);
}

export const AGENT_SCOPED_SESSION_ROOTS = Object.freeze([WORKSPACE_LAYOUT.AGENT_SESSION_DIR]);

export function resolveScopedSessionRoots(pluginDeclarations = []) {
  if (!Array.isArray(pluginDeclarations)) {
    throw new TypeError("scoped session root declarations must be an array");
  }
  const roots = [...AGENT_SCOPED_SESSION_ROOTS];
  for (const { pluginId, scopedSessionRoots } of pluginDeclarations) {
    if (!Array.isArray(scopedSessionRoots)) {
      throw new TypeError(`plugin ${pluginId} scopedSessionRoots must be an array`);
    }
    for (const root of scopedSessionRoots) {
      roots.push(resolvePluginDataRelativePath(pluginId, ...String(root ?? "").split("/")));
    }
  }
  if (new Set(roots).size !== roots.length) {
    throw new TypeError(`scoped session roots must be unique: ${roots.join(",")}`);
  }
  return Object.freeze(roots);
}

export function isWorkspaceRuntimeRelativePath(value) {
  const normalized = String(value ?? "");
  return (
    normalized.startsWith(`${WORKSPACE_LAYOUT.RUNTIME_DIR}/`) &&
    !normalized.split("/").includes("..")
  );
}
