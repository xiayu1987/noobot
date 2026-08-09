/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const TEXT_TOOLS = [
  "write_file", "search", "patch_file", "execute_script", "list_skills", "set_skill_task",
  "call_service", "call_mcp_task", "delegate_task_async", "wait_async_task_result",
  "plan_multi_task_collaboration", "switch_model", "user_interaction", "web_to_data",
  "doc_to_data", "media_to_data", "process_content_task", "process_connector_tool",
  "access_connector", "inspect_connectors", "web_search", "task_summary", "task_check",
  "request_help", "final_answer", "database_connect_connector", "terminal_connect_connector",
  "email_connect_connector",
];

export function registerToolOutputPolicies(register) {
  for (const toolName of TEXT_TOOLS) register({ toolName, type: "text" });
  register({ toolName: "read_file", type: "source_reference" });
  register({ toolName: "multimodal_generate", type: "attachment_bytes" });
}
