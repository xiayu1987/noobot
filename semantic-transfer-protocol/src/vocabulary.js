/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const DEFAULT_TRANSFER_MIME_TYPE = "text/plain";

export const TRANSFER_REASON = Object.freeze({
  SEMANTIC_TRANSFER_OUTPUT: "semantic_transfer_output",
  SEMANTIC_TRANSFER_TOOL_RESULT: "semantic_transfer_tool_result",
  SEMANTIC_TRANSFER_TOOL_OUTPUT: "semantic_transfer_tool_output",
  SEMANTIC_TRANSFER_TOOL_INPUT: "semantic_transfer_tool_input",
  WORKFLOW_SUBAGENT: "workflow_subagent",
  WORKFLOW_NODE_AGENT_RESULT: "workflow_node_agent_result",
  WORKFLOW_FINAL_ATTACHMENT_SUMMARY: "workflow_final_attachment_summary",
  HARNESS_SUMMARY: "harness_summary",
  HARNESS_ACCEPTANCE_OUTPUT: "harness_acceptance_output",
  HARNESS_PLANNING_OUTPUT: "harness_planning_output",
  TOOL_RESULT_OVERFLOW: "tool_result_overflow",
  TOOL_OUTPUT_ARTIFACT: "tool_output_artifact",
  MULTIMODAL_PARSE_ARTIFACT: "multimodal_parse_artifact",
  READ_FILE_SOURCE_REFERENCE: "read_file_source_reference",
  REUSE_DATA_PROCESSING_ARTIFACT: "reuse_data_processing_artifact",
  EXECUTE_SCRIPT_INPUT_TOO_LONG: "execute_script_input_too_long",
  EXECUTE_SCRIPT_BACKGROUND: "execute_script_background",
  EXECUTE_SCRIPT_OUTPUT_OVERFLOW: "execute_script_output_overflow",
  EXECUTE_NATIVE_SCRIPT_OUTPUT: "execute_native_script_output",
  WRITE_FILE_INPUT_TOO_LONG: "write_file_input_too_long",
  PATCH_FILE_INPUT_TOO_LONG: "patch_file_input_too_long",
});

export const TRANSFER_REASON_ALIAS = Object.freeze({
  semantic_transfer: TRANSFER_REASON.SEMANTIC_TRANSFER_OUTPUT,
  transfer_output: TRANSFER_REASON.SEMANTIC_TRANSFER_OUTPUT,
});
