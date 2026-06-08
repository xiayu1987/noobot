/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TRANSFER_PROTOCOL = "noobot.semantic-transfer";
export const TRANSFER_VERSION = 1;

export const TRANSFER_DIRECTION = Object.freeze({
  INPUT: "input",
  OUTPUT: "output",
});

export const TRANSFER_TRANSPORT = Object.freeze({
  DIRECT: "direct",
  FILE: "file",
});

export const TRANSFER_SOURCE = Object.freeze({
  USER: "user",
  SYSTEM: "system",
  AGENT: "agent",
  CHILD_AGENT: "subagent",
  MODEL: "model",
  TOOL: "tool",
  CONNECTOR: "connector",
  PLUGIN: "plugin",
  SERVICE: "service",
});

export const TRANSFER_STORAGE_KIND = Object.freeze({
  ATTACHMENT: "attachment",
  WORKSPACE: "workspace",
  TEMP: "temp",
  EXTERNAL: "external",
});

export const TRANSFER_REASON = Object.freeze({
  SEMANTIC_TRANSFER_OUTPUT: "semantic_transfer_output",
  SEMANTIC_TRANSFER_TOOL_RESULT: "semantic_transfer_tool_result",
  SEMANTIC_TRANSFER_TOOL_OUTPUT: "semantic_transfer_tool_output",
  SEMANTIC_TRANSFER_TOOL_INPUT: "semantic_transfer_tool_input",
  WORKFLOW_SUBAGENT_RESULT: "workflow_subagent_result",
  HARNESS_STAGE_MESSAGE: "harness_stage_message",
  TOOL_RESULT_OVERFLOW: "tool_result_overflow",
  CONSUME_TRANSFER_FILES: "consume_transfer_files",
  NORMALIZE_TRANSFER_FILE_PATH: "normalize_transfer_file_path",
  SEMANTIC_TRANSFER_FILE_PATH: "semantic_transfer_file_path",
  ASYNC_SUBTASK_RESULT: "async_subtask_result",
  REUSE_DATA_PROCESSING_ARTIFACT: "reuse_data_processing_artifact",
  EXECUTE_SCRIPT_INPUT_TOO_LONG: "execute_script_input_too_long",
  WRITE_FILE_INPUT_TOO_LONG: "write_file_input_too_long",
});

export const DEFAULT_TRANSFER_MIME_TYPE = "text/plain";
