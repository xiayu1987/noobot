/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

const TOOL_INPUT_MAX_CHARS =
  LENGTH_THRESHOLDS.semanticTransfer.toolInputOverflowChars;

export const SEMANTIC_TRANSFER_REGISTRATION = Object.freeze({
  SCENARIOS: Object.freeze({
    TOOL: "tool",
    WORKFLOW: "workflow",
    HARNESS: "harness",
  }),
  TOOL_STRATEGIES: Object.freeze({
    INPUT: "tool_input",
    OUTPUT: "tool_output",
    RESULT_TEXT: "tool_result_text",
  }),
});

const inputPolicies = new Map();
const outputPolicies = new Map();
const scenarios = new Map();

function text(value = "") {
  return String(value ?? "").trim();
}

function requireText(value, code) {
  const normalized = text(value);
  if (!normalized) throw new Error(code);
  return normalized;
}

export function registerSemanticTransferScenario({
  name,
  strategies = [],
} = {}) {
  const scenario = requireText(name, "semantic_transfer_scenario_required");
  if (scenarios.has(scenario))
    throw new Error(`semantic_transfer_scenario_duplicate:${scenario}`);
  const registeredStrategies = new Set(
    (Array.isArray(strategies) ? strategies : []).map((item) =>
      requireText(item, "semantic_transfer_strategy_required"),
    ),
  );
  if (!registeredStrategies.size)
    throw new Error(
      `semantic_transfer_scenario_strategies_required:${scenario}`,
    );
  scenarios.set(
    scenario,
    Object.freeze({
      name: scenario,
      strategies: Object.freeze([...registeredStrategies]),
    }),
  );
  return scenarios.get(scenario);
}

export function registerToolInputPolicy({
  toolName,
  field,
  maxChars,
  forceAttachment = false,
  enabled = null,
  name = "tool-input.txt",
  mimeType = "text/plain",
  reason = "semantic_transfer_tool_input",
  message = "semantic transfer input exceeded",
} = {}) {
  const nameKey = requireText(toolName, "semantic_transfer_tool_name_required");
  if (inputPolicies.has(nameKey))
    throw new Error(`semantic_transfer_tool_input_policy_duplicate:${nameKey}`);
  const max = Number(maxChars);
  if (!Number.isSafeInteger(max) || max < 0)
    throw new Error(
      `semantic_transfer_tool_input_policy_max_chars_invalid:${nameKey}`,
    );
  inputPolicies.set(
    nameKey,
    Object.freeze({
      toolName: nameKey,
      field: requireText(field, "semantic_transfer_tool_input_field_required"),
      maxChars: max,
      forceAttachment: forceAttachment === true,
      enabled: typeof enabled === "function" ? enabled : null,
      name:
        typeof name === "function"
          ? name
          : () =>
              requireText(name, "semantic_transfer_tool_input_name_required"),
      mimeType: requireText(
        mimeType,
        "semantic_transfer_tool_input_mime_required",
      ),
      reason: requireText(
        reason,
        "semantic_transfer_tool_input_reason_required",
      ),
      message: requireText(
        message,
        "semantic_transfer_tool_input_message_required",
      ),
    }),
  );
}

export function registerToolOutputPolicy({ toolName, type = "text" } = {}) {
  const name = requireText(toolName, "semantic_transfer_tool_name_required");
  if (outputPolicies.has(name))
    throw new Error(`semantic_transfer_tool_output_policy_duplicate:${name}`);
  if (!["text", "attachment_bytes", "attachment_url"].includes(type)) {
    throw new Error(`semantic_transfer_tool_output_type_invalid:${name}`);
  }
  outputPolicies.set(name, Object.freeze({ toolName: name, type }));
}

export function assertSemanticTransferRegistration({
  scenario,
  strategy,
} = {}) {
  const registered = scenarios.get(
    requireText(scenario, "semantic_transfer_scenario_required"),
  );
  if (!registered)
    throw new Error(`semantic_transfer_scenario_not_registered:${scenario}`);
  const normalizedStrategy = requireText(
    strategy,
    "semantic_transfer_strategy_required",
  );
  if (!registered.strategies.includes(normalizedStrategy)) {
    throw new Error(
      `semantic_transfer_strategy_not_registered:${scenario}:${normalizedStrategy}`,
    );
  }
  return registered;
}

export function getToolInputPolicy(toolName, args = {}) {
  const policy = inputPolicies.get(
    requireText(toolName, "semantic_transfer_tool_name_required"),
  );
  if (!policy)
    throw new Error(
      `semantic_transfer_tool_input_policy_not_registered:${toolName}`,
    );
  if (policy.enabled && policy.enabled({ args }) !== true) return null;
  return policy;
}

export function hasToolInputPolicy(toolName) {
  return inputPolicies.has(
    requireText(toolName, "semantic_transfer_tool_name_required"),
  );
}

export function getToolOutputPolicy(toolName) {
  const policy = outputPolicies.get(
    requireText(toolName, "semantic_transfer_tool_name_required"),
  );
  if (!policy)
    throw new Error(
      `semantic_transfer_tool_output_policy_not_registered:${toolName}`,
    );
  return policy;
}

registerSemanticTransferScenario({
  name: SEMANTIC_TRANSFER_REGISTRATION.SCENARIOS.TOOL,
  strategies: Object.values(SEMANTIC_TRANSFER_REGISTRATION.TOOL_STRATEGIES),
});
registerSemanticTransferScenario({
  name: SEMANTIC_TRANSFER_REGISTRATION.SCENARIOS.WORKFLOW,
  strategies: ["workflow_subagent", "workflow_final_plan"],
});
registerSemanticTransferScenario({
  name: SEMANTIC_TRANSFER_REGISTRATION.SCENARIOS.HARNESS,
  strategies: ["harness_summary"],
});

registerToolInputPolicy({
  toolName: "write_file",
  field: "content",
  maxChars: TOOL_INPUT_MAX_CHARS,
  reason: "write_file_input_too_long",
  message: "文件内容过长，请分批写入",
  name: ({ args = {} }) =>
    `${text(args.filePath).split(/[\\/]/).pop() || "write-file-content"}.tool-input.txt`,
});
registerToolInputPolicy({
  toolName: "execute_script",
  field: "command",
  maxChars: TOOL_INPUT_MAX_CHARS,
  reason: "execute_script_input_too_long",
  message: "脚本内容过长，请分批执行或拆分脚本/文本后重试",
  name: "execute-script-command.tool-input.sh",
});
registerToolInputPolicy({
  toolName: "search",
  field: "text",
  maxChars: TOOL_INPUT_MAX_CHARS,
  reason: "semantic_transfer_tool_input",
  message: "text is too long; search in smaller chunks",
  enabled: ({ args = {} }) => text(args.source || "files") === "text",
  name: "search-text.tool-input.txt",
});
registerToolInputPolicy({
  toolName: "patch_file",
  field: "patch",
  maxChars: TOOL_INPUT_MAX_CHARS,
  reason: "patch_file_input_too_long",
  message: "补丁内容过长，请分批应用或拆分 patch 后重试",
  name: "patch-file-patch.tool-input.diff",
});
registerToolInputPolicy({
  toolName: "task_summary",
  field: "summaryContent",
  maxChars: TOOL_INPUT_MAX_CHARS,
  forceAttachment: true,
  reason: "semantic_transfer_tool_input",
  name: "task-summary-content.tool-input.md",
});

for (const toolName of [
  "read_file",
  "write_file",
  "search",
  "patch_file",
  "execute_script",
  "list_skills",
  "set_skill_task",
  "call_service",
  "call_mcp_task",
  "delegate_task_async",
  "wait_async_task_result",
  "plan_multi_task_collaboration",
  "switch_model",
  "user_interaction",
  "web_to_data",
  "doc_to_data",
  "media_to_data",
  "process_content_task",
  "process_connector_tool",
  "access_connector",
  "inspect_connectors",
  "web_search",
  "task_summary",
  "task_check",
  "request_help",
  "final_answer",
  "database_connect_connector",
  "terminal_connect_connector",
  "email_connect_connector",
]) {
  registerToolOutputPolicy({ toolName, type: "text" });
}
registerToolOutputPolicy({
  toolName: "multimodal_generate",
  type: "attachment_bytes",
});
