/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TRANSFER_REASON = Object.freeze({
  SEMANTIC_TRANSFER_OUTPUT: "semantic_transfer_output",
  SEMANTIC_TRANSFER_TOOL_RESULT: "semantic_transfer_tool_result",
  SEMANTIC_TRANSFER_TOOL_OUTPUT: "semantic_transfer_tool_output",
  SEMANTIC_TRANSFER_TOOL_INPUT: "semantic_transfer_tool_input",
  WORKFLOW_SUBAGENT: "workflow_subagent",
  HARNESS_SUMMARY: "harness_summary",
  TOOL_RESULT_OVERFLOW: "tool_result_overflow",
  REUSE_DATA_PROCESSING_ARTIFACT: "reuse_data_processing_artifact",
  EXECUTE_SCRIPT_INPUT_TOO_LONG: "execute_script_input_too_long",
  WRITE_FILE_INPUT_TOO_LONG: "write_file_input_too_long",
  PATCH_FILE_INPUT_TOO_LONG: "patch_file_input_too_long",
});

export const DEFAULT_TRANSFER_MIME_TYPE = "text/plain";
