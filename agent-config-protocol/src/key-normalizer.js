/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "./utils.js";

export const SNAKE_TO_CANONICAL_KEY_MAP = {
  workspace_root: "workspaceRoot",
  workspace_template_path: "workspaceTemplatePath",
  memory_max_items: "memoryMaxItems",
  max_tool_loop_turns: "maxToolLoopTurns",
  switch_web_mode: "switchWebMode",
  execution_isolation: "executionIsolation",
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
  container_name: "containerName",
  read_only: "readOnly",
  lock_wait_timeout_ms: "lockWaitTimeoutMs",
  image: "image",
  mounts: "mounts",
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
  default_models: "defaultModels",
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
  return out;
}
