/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "../../utils/shared-utils.js";

export const SNAKE_TO_CANONICAL_KEY_MAP = {
  workspace_root: "workspaceRoot",
  workspace_template_path: "workspaceTemplatePath",
  memory_max_items: "memoryMaxItems",
  max_tool_loop_turns: "maxToolLoopTurns",
  recent_message_limit: "recentMessageLimit",
  main_model_recent_window: "mainModelRecentWindow",
  main_model_recent_limit: "mainModelRecentLimit",
  use_last_running_task_range: "useLastRunningTaskRange",
  use_last_completed_task_range: "useLastCompletedTaskRange",
  switch_web_mode: "switchWebMode",
  sandbox_mode: "sandboxMode",
  sandbox_provider: "sandboxProvider",
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
  max_output_chars: "maxOutputChars",
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
  const inMcpServersSubtree =
    currentPath[0] === "mcpServers" || currentPath[0] === "mcp_servers";

  const out = {};
  for (const [rawKey, value] of Object.entries(input)) {
    const normalizedKey = inMcpServersSubtree
      ? rawKey
      : SNAKE_TO_CANONICAL_KEY_MAP[rawKey] || rawKey;
    out[normalizedKey] = normalizeKnownConfigKeys(
      value,
      [...currentPath, normalizedKey],
    );
  }
  return out;
}
