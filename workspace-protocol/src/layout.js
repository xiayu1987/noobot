/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const WORKSPACE_LAYOUT_VERSION = 1;

export const WORKSPACE_LAYOUT = Object.freeze({
  CONFIG_FILE: "config.json",
  RETIRED_CONFIG_EXAMPLE_FILE: "config.example.json",
  MEMORY_DIR: "memory",
  SERVICES_DIR: "services",
  SKILLS_DIR: "skills",
  RUNTIME_DIR: "runtime",
  SESSION_DIR: "runtime/session",
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
  ASSET_STATE_FILE: "runtime/workspace-asset-state.json",
});

export const WORKSPACE_RUNTIME_DIRECTORIES = Object.freeze([
  WORKSPACE_LAYOUT.SESSION_DIR,
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

export function isWorkspaceRuntimeRelativePath(value) {
  const normalized = String(value ?? "");
  return (
    normalized.startsWith(`${WORKSPACE_LAYOUT.RUNTIME_DIR}/`) &&
    !normalized.split("/").includes("..")
  );
}
