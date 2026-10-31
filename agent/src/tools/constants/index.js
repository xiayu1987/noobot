/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export { WEB_SEARCH_MODE } from "@noobot/agent-config-protocol";
import { TASK_CHECK_TOOL_NAME } from "@noobot/context-protocol/task/check-receipt";

export const TOOL_POLICY_MODE = Object.freeze({
  CUSTOM_ONLY: "custom_only",
});

export const TOOL_NAME = Object.freeze({
  READ_FILE: "read_file",
  WRITE_FILE: "write_file",
  SEARCH: "search",
  PATCH_FILE: "patch_file",
  EXECUTE_SCRIPT: "execute_script",
  EXECUTE_NATIVE_SCRIPT: "execute_native_script",
  LIST_SKILLS: "list_skills",
  CALL_SERVICE: "call_service",
  CALL_MCP_TASK: "call_mcp_task",
  SWITCH_MODEL: "switch_model",
  USER_INTERACTION: "user_interaction",
  ACCESS_CONNECTOR: "access_connector",
  DO_SEARCH_WEB: "do_search_web",
  MULTIMODAL_GENERATE: "multimodal_generate",
  MULTIMODAL_PARSE: "multimodal_parse",
  TASK_SUMMARY: "task_summary",
  TASK_CHECK: TASK_CHECK_TOOL_NAME,
  HELP: "help",
});

export const CONTROL_TOOL_NAMES = Object.freeze([TOOL_NAME.TASK_SUMMARY, TOOL_NAME.TASK_CHECK]);

export const ARTIFACT_GENERATION_SOURCE = Object.freeze({
  MULTIMODAL_GENERATE_TOOL: "multimodal_generate_tool",
  MULTIMODAL_PARSE_TOOL: "multimodal_parse_tool",
  EMAIL_CONNECTOR_READ: "email_connector_read",
});

export const TOOL_CALL_MODE = Object.freeze({
  MULTIMODAL_GENERATION: "multimodal_generation",
  MULTIMODAL_PARSE: "multimodal_parse",
});

export const TOOL_DATA_MODE = Object.freeze({
  DIRECT_TEXT: "direct_text",
  IMAGE_MODEL: "image_model",
  MULTIMODAL_MODEL: "multimodal_model",
  DIRECT: "direct",
  BROWSER_SIMULATE: "browser_simulate",
});

export const TOOL_EVENT_NAME = Object.freeze({
  CALL_MCP_TASK_FAILED: "call_mcp_task_failed",
});
