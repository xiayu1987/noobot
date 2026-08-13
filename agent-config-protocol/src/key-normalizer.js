/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "./utils.js";

function configValuesEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => configValuesEqual(value, right[index]))
    );
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(right, key) && configValuesEqual(left[key], right[key]))
  );
}

export const SNAKE_TO_CANONICAL_KEY_MAP = {
  workspace_root: "workspaceRoot",
  workspace_template_path: "workspaceTemplatePath",
  memory_max_items: "memoryMaxItems",
  max_tool_loop_turns: "maxToolLoopTurns",
  switch_web_mode: "switchWebMode",
  sandbox_mode: "sandboxMode",
  sandbox_provider: "sandboxProvider",
  path_policy: "pathPolicy",
  regular_user: "regularUser",
  accepted_views: "acceptedViews",
  host_requires_role: "hostRequiresRole",
  allowed_roots: "allowedRoots",
  denied_roots: "deniedRoots",
  follow_symbolic_links: "followSymbolicLinks",
  require_real_path_for_existing_targets: "requireRealPathForExistingTargets",
  validate_write_parent_real_path: "validateWriteParentRealPath",
  reject_ambiguous_virtual_paths: "rejectAmbiguousVirtualPaths",
  case_sensitivity: "caseSensitivity",
  file_tools: "fileTools",
  script_tools: "scriptTools",
  native_script: "nativeScript",
  task_local: "taskLocal",
  docker_container_scope: "dockerContainerScope",
  docker_container_name: "dockerContainerName",
  docker_image: "dockerImage",
  docker_mounts: "dockerMounts",
  mount_source: "mountSource",
  mount_target: "mountTarget",
  mount_description: "mountDescription",
  docker_project_mount_source: "dockerProjectMountSource",
  docker_project_mount_target: "dockerProjectMountTarget",
  docker_lock_wait_timeout_ms: "dockerLockWaitTimeoutMs",
  wait_timeout_ms: "waitTimeoutMs",
  poll_interval_ms: "pollIntervalMs",
  max_sub_agent_depth: "maxSubAgentDepth",
  script_timeout_ms: "scriptTimeoutMs",
  run_timeout_ms: "runTimeoutMs",
  phase_summary_loop_turns: "phaseSummaryLoopTurns",
  phase_summary_message_chars_threshold: "phaseSummaryMessageCharsThreshold",
  super_admin: "superAdmin",
  user_id: "userId",
  connect_code: "connectCode",
  default_provider: "defaultProvider",
  max_file_size_bytes: "maxFileSizeBytes",
  max_total_size_bytes: "maxTotalSizeBytes",
  max_file_count: "maxFileCount",
  allowed_mime_types: "allowedMimeTypes",
  allowed_extensions: "allowedExtensions",
  mcp_servers: "mcpServers",
};

export function normalizeKnownConfigKeys(input, path = []) {
  if (Array.isArray(input)) {
    return input.map((item) => normalizeKnownConfigKeys(item, path));
  }
  if (!isPlainObject(input)) return input;

  const currentPath = Array.isArray(path) ? path : [];
  const inMcpServersSubtree = currentPath[0] === "mcpServers" || currentPath[0] === "mcp_servers";

  const out = {};
  for (const [rawKey, value] of Object.entries(input)) {
    const normalizedKey = inMcpServersSubtree
      ? rawKey
      : SNAKE_TO_CANONICAL_KEY_MAP[rawKey] || rawKey;
    out[normalizedKey] = normalizeKnownConfigKeys(value, [...currentPath, normalizedKey]);
  }
  if (currentPath[0] === "tools" && currentPath[1] === "execute_script") {
    const hasMode = Object.hasOwn(out, "sandboxMode");
    const hasProvider = Object.hasOwn(out, "sandboxProvider");
    const execution = isPlainObject(out.execution) ? { ...out.execution } : {};
    if (hasMode) {
      const mappedView = out.sandboxMode === true ? "sandbox" : "host";
      if (execution.view !== undefined && execution.view !== mappedView) {
        throw new Error("tools.execute_script sandbox_mode conflicts with execution.view");
      }
      execution.view = mappedView;
      delete out.sandboxMode;
    }
    if (hasProvider) {
      if (
        execution.sandboxProvider !== undefined &&
        !configValuesEqual(execution.sandboxProvider, out.sandboxProvider)
      ) {
        throw new Error(
          "tools.execute_script sandbox_provider conflicts with execution.sandboxProvider",
        );
      }
      execution.sandboxProvider = out.sandboxProvider;
      delete out.sandboxProvider;
    }
    if (hasMode || hasProvider || Object.hasOwn(out, "execution")) out.execution = execution;
  }
  return out;
}
