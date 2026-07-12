/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const DEFAULT_WORKSPACE_ROOT = "../workspace";
export const DEFAULT_TEMPLATE_PATH = "../user-template/default-user";
export const DEFAULT_SUPER_ADMIN_USER_ID = "admin";
export const DEFAULT_SUPER_ADMIN_CONNECT_CODE = "change-your-connect-code";
export const MODEL_FORMAT_VALUES = new Set(["dashscope", "openai_compatible"]);
export const CONFIG_SYNC_SKIP_TOP_LEVEL_KEYS = new Set([
  "workspace_root",
  "workspaceRoot",
  "workspace_template_path",
  "workspaceTemplatePath",
  "streaming",
  "super_admin",
  "superAdmin",
]);

export const BUILTIN_CONFIG_PRUNE_PATHS = Object.freeze([
  ["memory_max_items"],
  ["memoryMaxItems"],
  ["max_tool_loop_turns"],
  ["maxToolLoopTurns"],
  ["run_timeout_ms"], // legacyKeys prune
  ["runTimeoutMs"],
  ["attachments", "max_file_count"],
  ["attachments", "maxFileCount"],
  ["attachments", "max_file_size_bytes"],
  ["attachments", "maxFileSizeBytes"],
  ["attachments", "max_total_size_bytes"],
  ["attachments", "maxTotalSizeBytes"],
  ["attachments", "allowed_extensions"],
  ["attachments", "allowedExtensions"],
  ["attachments", "allowed_mime_types"],
  ["attachments", "allowedMimeTypes"],
  ["tools", "delegate_task_async", "wait_timeout_ms"],
  ["tools", "delegate_task_async", "waitTimeoutMs"],
  ["tools", "delegate_task_async", "max_sub_agent_depth"],
  ["tools", "delegate_task_async", "maxSubAgentDepth"],
  ["tools", "delegate_task_async", "poll_interval_ms"],
  ["tools", "delegate_task_async", "pollIntervalMs"],
  ["tools", "wait_async_task_result", "poll_interval_ms"],
  ["tools", "wait_async_task_result", "pollIntervalMs"],
  ["tools", "process_content_task", "max_tool_loop_turns"],
  ["tools", "process_content_task", "maxToolLoopTurns"],
  ["tools", "execute_script", "script_timeout_ms"],
  ["tools", "execute_script", "scriptTimeoutMs"],
  ["tools", "process_connector_tool", "max_tool_loop_turns"],
  ["tools", "process_connector_tool", "maxToolLoopTurns"],
  ["tools", "access_connector", "command_file", "max_bytes"],
  ["tools", "access_connector", "command_file", "maxBytes"],
  ["tools", "access_connector", "command_file", "allowed_extensions"],
  ["tools", "access_connector", "command_file", "allowedExtensions"],
  ["tools", "task_summary", "phase_summary_loop_turns"],
  ["tools", "task_summary", "phaseSummaryLoopTurns"],
  ["tools", "task_summary", "phase_summary_message_chars_threshold"],
  ["tools", "task_summary", "phaseSummaryMessageCharsThreshold"],
  ["tools", "task_summary", "max_tool_loop_turns"],
  ["tools", "task_summary", "maxToolLoopTurns"],
  ["tools", "request_help", "help_prompt_loop_turns"],
  ["tools", "request_help", "helpPromptLoopTurns"],
  ["tools", "request_help", "tool_failure_help_count"],
  ["tools", "request_help", "toolFailureHelpCount"],
  ["plugins", "workflow", "timeout_ms"],
  ["plugins", "workflow", "timeoutMs"],
  ["plugins", "workflow", "maxAutoTransitions"],
  ["plugins", "workflow", "maxParallelNodeAgents"],
  ["plugins", "workflow", "miniRunnerMaxTurns"],
  ["plugins", "harness", "miniRunnerMaxTurns"],
  ["openvscode", "start_timeout_ms"],
  ["openvscode", "startTimeoutMs"],
  ["openvscode", "idle_timeout_ms"],
  ["openvscode", "idleTimeoutMs"],
]);

export const BUILTIN_SCENARIO_KEYS = new Set(["full", "programming", "text"]);
