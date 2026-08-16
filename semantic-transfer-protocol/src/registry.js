/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TOOL_SCENARIO, TOOL_STRATEGIES } from "./strategies/tool-strategies.mjs";
import { HARNESS_SCENARIO, HARNESS_STRATEGIES } from "./strategies/harness-strategies.mjs";
import { WORKFLOW_SCENARIO, WORKFLOW_STRATEGIES } from "./strategies/workflow-strategies.mjs";
import { registerToolInputPolicies } from "./policies/tool-input-policies.mjs";
import { registerToolOutputPolicies } from "./policies/tool-output-policies.mjs";

export const SEMANTIC_TRANSFER_REGISTRATION = Object.freeze({
  SCENARIOS: Object.freeze({
    TOOL: "tool",
    WORKFLOW: "workflow",
    HARNESS: "harness",
  }),
  TOOL_STRATEGIES,
  HARNESS_STRATEGIES,
  WORKFLOW_STRATEGIES,
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
  categories = {},
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
      categories: Object.freeze(Object.fromEntries(
        Object.entries(categories && typeof categories === "object" ? categories : {}).map(([category, points]) => [
          text(category),
          Object.freeze((Array.isArray(points) ? points : []).map((point) => requireText(point, "semantic_transfer_business_point_required"))),
        ]),
      )),
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
  if (!["text", "attachment_bytes", "attachment_url", "source_reference"].includes(type)) {
    throw new Error(`semantic_transfer_tool_output_type_invalid:${name}`);
  }
  outputPolicies.set(name, Object.freeze({ toolName: name, type }));
}

export function assertSemanticTransferRegistration({
  scenario,
  strategy,
  category = "",
  businessPoint = "",
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
  if (text(category) || text(businessPoint)) {
    const points = registered.categories?.[text(category)];
    if (!points || !points.includes(text(businessPoint))) {
      throw new Error(`semantic_transfer_business_point_not_registered:${scenario}:${text(category)}:${text(businessPoint)}`);
    }
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
  ...TOOL_SCENARIO,
});
registerSemanticTransferScenario({
  ...WORKFLOW_SCENARIO,
});
registerSemanticTransferScenario({
  ...HARNESS_SCENARIO,
});

registerToolInputPolicies(registerToolInputPolicy);
registerToolOutputPolicies(registerToolOutputPolicy);
