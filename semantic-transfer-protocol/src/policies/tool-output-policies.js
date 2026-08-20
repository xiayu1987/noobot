/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const TEXT_TOOLS = [
  "write_file",
  "search",
  "patch_file",
  "execute_script",
  "list_skills",
  "call_service",
  "call_mcp_task",
  "delegate_task_async",
  "wait_async_task_result",
  "plan_multi_task_collaboration",
  "switch_model",
  "user_interaction",
  "access_connector",
  "web_search",
  "task_summary",
  "task_check",
  "request_help",
  "final_answer",
];

export function registerToolOutputPolicies(register) {
  for (const toolName of TEXT_TOOLS) register({ toolName, type: "text" });
  register({ toolName: "read_file", type: "source_reference" });
  register({ toolName: "multimodal_generate", type: "attachment_bytes" });
}
