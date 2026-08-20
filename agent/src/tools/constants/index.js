/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

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
  DELEGATE_TASK_ASYNC: "delegate_task_async",
  WAIT_ASYNC_TASK_RESULT: "wait_async_task_result",
  PLAN_MULTI_TASK_COLLABORATION: "plan_multi_task_collaboration",
  SWITCH_MODEL: "switch_model",
  USER_INTERACTION: "user_interaction",
  PROCESS_CONNECTOR_TOOL: "process_connector_tool",
  ACCESS_CONNECTOR: "access_connector",
  INSPECT_CONNECTORS: "inspect_connectors",
  WEB_SEARCH: "web_search",
  MULTIMODAL_GENERATE: "multimodal_generate",
  MULTIMODAL_PARSE: "multimodal_parse",
  TASK_SUMMARY: "task_summary",
  TASK_CHECK: "task_check",
  REQUEST_HELP: "request_help",
  FINAL_ANSWER: "final_answer",
});

export const TOOL_CONFIG_ALIAS_KEY = Object.freeze({
  FILE: "file",
  SKILL: "skill",
  SERVICE: "service",
  MCP: "mcp",
  AGENT_COLLAB: "agent_collab",
  MODEL: "model",
});

export const TOOL_RESULT_STATE = Object.freeze({
  OK: "OK",
});

export const TOOL_RESULT_STATUS = Object.freeze({
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  PARTIAL_FAILED: "partial_failed",
  FINALIZE: "finalize",
  OK: "ok",
  ERROR: "error",
});

export const TOOL_CALLER = Object.freeze({
  BOT: "bot",
});

export const TOOL_ATTACHMENT_SOURCE = Object.freeze({
  MODEL: "model",
  EMAIL: "email",
});

export const ARTIFACT_GENERATION_SOURCE = Object.freeze({
  MULTIMODAL_GENERATE_TOOL: "multimodal_generate_tool",
  MULTIMODAL_PARSE_TOOL: "multimodal_parse_tool",
  EMAIL_CONNECTOR_READ: "email_connector_read",
});

export const TOOL_CALL_MODE = Object.freeze({
  OPENAI_RESPONSES_API: "openai_responses_api",
  IMAGES_ASYNC_API: "images_async_api",
});

export const IMAGE_GENERATION_API_TYPE = Object.freeze({
  OPENAI_RESPONSES: "openai_responses",
  IMAGES_ASYNC: "images_async",
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
