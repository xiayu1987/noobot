/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const SANDBOX_CONFIG = Object.freeze({
  PROVIDERS: Object.freeze({
    DOCKER: "docker",
    BUBBLEWRAP: "bubblewrap",
    FIREJAIL: "firejail",
  }),
  DOCKER: Object.freeze({
    DEFAULT_CONTAINER_SCOPE: "global",
    DEFAULT_CONTAINER_NAME: "noobot-script-sandbox",
    DEFAULT_IMAGE: "nikolaik/python-nodejs:python3.12-nodejs26-bookworm",
  }),
  COMMANDS: Object.freeze({
    DOCKER: "docker",
    FIREJAIL: "firejail",
    BUBBLEWRAP: "bwrap",
  }),
  TOOL_POLICY_MODE: Object.freeze({
    CUSTOM_ONLY: "custom_only",
  }),
});

export const CONNECTOR_TYPE = Object.freeze({
  DATABASE: "database",
  TERMINAL: "terminal",
  EMAIL: "email",
  DATABASE_ENGINE: Object.freeze({
    SQLITE: "sqlite",
  }),
  TERMINAL_PROTOCOL: Object.freeze({
    SSH: "ssh",
  }),
  CHANNEL_BUCKET: Object.freeze({
    DATABASE: "databases",
    TERMINAL: "terminals",
    EMAIL: "emails",
  }),
  CONNECT_TOOL_NAME: Object.freeze({
    DATABASE: "database_connect_connector",
    TERMINAL: "terminal_connect_connector",
    EMAIL: "email_connect_connector",
  }),
});

export const TOOL_NAME = Object.freeze({
  READ_FILE: "read_file",
  WRITE_FILE: "write_file",
  SEARCH: "search",
  PATCH_FILE: "patch_file",
  EXECUTE_SCRIPT: "execute_script",
  LIST_SKILLS: "list_skills",
  SET_SKILL_TASK: "set_skill_task",
  CALL_SERVICE: "call_service",
  CALL_MCP_TASK: "call_mcp_task",
  DELEGATE_TASK_ASYNC: "delegate_task_async",
  WAIT_ASYNC_TASK_RESULT: "wait_async_task_result",
  PLAN_MULTI_TASK_COLLABORATION: "plan_multi_task_collaboration",
  SWITCH_MODEL: "switch_model",
  USER_INTERACTION: "user_interaction",
  WEB_TO_DATA: "web_to_data",
  DOC_TO_DATA: "doc_to_data",
  MEDIA_TO_DATA: "media_to_data",
  PROCESS_CONTENT_TASK: "process_content_task",
  PROCESS_CONNECTOR_TOOL: "process_connector_tool",
  ACCESS_CONNECTOR: "access_connector",
  INSPECT_CONNECTORS: "inspect_connectors",
  WEB_SEARCH: "web_search",
  MULTIMODAL_GENERATE: "multimodal_generate",
  TASK_SUMMARY: "task_summary",
  REQUEST_HELP: "request_help",
  FINAL_ANSWER: "final_answer",
  DATABASE_CONNECT_CONNECTOR: "database_connect_connector",
  TERMINAL_CONNECT_CONNECTOR: "terminal_connect_connector",
  EMAIL_CONNECT_CONNECTOR: "email_connect_connector",
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
  NO_CONNECTORS: "no_connectors",
  NEEDS_RECONNECT: "needs_reconnect",
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
  DOC_TO_DATA_TOOL: "doc_to_data_tool",
  MEDIA_TO_DATA_TOOL: "media_to_data_tool",
  WEB_TO_DATA_TOOL: "web_to_data_tool",
  EMAIL_CONNECTOR_READ: "email_connector_read",
});

export const TOOL_CALL_MODE = Object.freeze({
  OPENAI_RESPONSES_API: "openai_responses_api",
});

export const TOOL_DATA_MODE = Object.freeze({
  DIRECT_TEXT: "direct_text",
  IMAGE_MODEL: "image_model",
  DIRECT: "direct",
  BROWSER_SIMULATE: "browser_simulate",
});

export const TOOL_EVENT_NAME = Object.freeze({
  CALL_MCP_TASK_FAILED: "call_mcp_task_failed",
});
