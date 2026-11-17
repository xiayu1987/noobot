/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash } from "node:crypto";
import { createNamespacedToolId } from "@noobot/model-protocol/tool-identity-node";
import { MCP_TEST_SERVICE } from "../mcp-test-service/config.mjs";
import { characterSteps, PERF_PLUGIN_TOOLS } from "./character-scenario.mjs";
import { PERF_HARNESS_MODELS } from "./performance-contract.mjs";
import { readReplayContext } from "./replay-context.mjs";
import { harnessReply, semanticAcceptanceReply } from "./harness-scenario.mjs";

export const MOCK_MODEL = Object.freeze({
  hostname: "noobot-mock-model",
  port: 8081,
  alias: "e2e_mock",
});
const PERF_CONTENT = "NOOBOT-PERF-BEFORE\n";
export const PERF_TOOLS = Object.freeze([
  "write_file",
  "read_file",
  "search",
  "patch_file",
  "execute_script",
  "execute_native_script",
  "list_skills",
  "help",
  "user_interaction",
  "task_check",
  "call_mcp_task",
  "call_service",
  "switch_model",
  "do_search_web",
  "multimodal_generate",
  "multimodal_parse",
  "access_connector",
]);
export const PERF_ALL_TOOLS = Object.freeze([...PERF_TOOLS, ...PERF_PLUGIN_TOOLS]);

export function mockProvider() {
  return {
    supplier: "OpenAI",
    is_custom: true,
    enabled: true,
    used_for_conversation: true,
    api_key: "e2e-only",
    base_url: `http://${MOCK_MODEL.hostname}:${MOCK_MODEL.port}/v1`,
    model: MOCK_MODEL.alias,
    use_responses_api: false,
    prompt_cache_fields: [],
    reasoning_effort: "medium",
    tool_reasoning_effort: "medium",
    reasoning_effort_options: ["low", "medium", "high"],
    reasoning_effort_parameter: "reasoning_effort",
    multimodal_parsing: { enabled: true, input_modalities: ["image"] },
    multimodal_generation: {
      support_generation: { enabled: true, support_scope: ["image"], api_type: "openai_images" },
    },
  };
}

export function scenarioSteps(filePath, connectorId = "e2e-perf", repetition = 0) {
  return [
    { name: "write_file", args: { filePath, content: PERF_CONTENT, riskLevel: "low" } },
    { name: "read_file", args: { filePath, riskLevel: "low" } },
    { name: "search", args: { path: filePath, query: "NOOBOT-PERF-BEFORE", riskLevel: "low" } },
    {
      name: "patch_file",
      args: {
        baseVersions: [
          { filePath, sha256: createHash("sha256").update(PERF_CONTENT).digest("hex") },
        ],
        patch: `*** Begin Patch\n*** Update File: ${filePath}\n@@\n-NOOBOT-PERF-BEFORE\n+NOOBOT-PERF-AFTER\n*** End Patch`,
        riskLevel: "low",
      },
    },
    { name: "execute_script", args: { command: "printf NOOBOT-PERF-SCRIPT", riskLevel: "low" } },
    {
      name: "execute_native_script",
      args: { script_body: 'console.log("NOOBOT-PERF-NATIVE")', riskLevel: "low" },
    },
    { name: "list_skills", args: {} },
    { name: "help", args: { command: "--tools --name read_file" } },
    {
      name: "user_interaction",
      args: {
        content: "NOOBOT-PERF-INTERACTION",
        fields: {
          fields: [{ name: "verificationCode", displayName: "Verification Code", required: true }],
        },
      },
    },
    {
      name: "task_check",
      args: {
        checkContent:
          "NOOBOT_TASK_CHECK/1\n[STATE]\nCONTINUE\n[ABSTRACT]\nPerformance replay\n[DETAILS]\nDeterministic tool chain\n[NEXT_ACTION]\nComplete replay",
      },
    },
    {
      name: "call_mcp_task",
      args: {
        mcpName: "e2e_mcp",
        task: "NOOBOT-PERF-MCP: call echo once with text NOOBOT-PERF-ECHO and return it.",
      },
    },
    {
      name: "call_service",
      args: {
        serviceName: "e2e_perf",
        endpointName: "echo",
        body: { text: "NOOBOT-PERF-SERVICE" },
      },
    },
    { name: "switch_model", args: { modelName: `${MOCK_MODEL.alias}_alternate` } },
    { name: "do_search_web", args: { query: "NOOBOT-PERF-SEARCH" } },
    {
      name: "multimodal_generate",
      args: {
        generation_content: "NOOBOT-PERF-IMAGE",
        output_type: "image",
        model_name: MOCK_MODEL.alias,
        size: "1024x1024",
      },
    },
    {
      name: "multimodal_parse",
      args: {
        inputs: [{ source: "runtime/ops_workdir/perf-input.png" }],
        model_name: MOCK_MODEL.alias,
        prompt: "NOOBOT-PERF-PARSE",
      },
    },
    {
      name: "access_connector",
      args: {
        connector_id: connectorId,
        operation: "execute",
        input: { command: "SELECT 1 AS performance_probe" },
      },
    },
    ...characterSteps(filePath, repetition),
  ];
}

export function nextReply(body) {
  const messages = body.messages || [];
  const purpose = Object.entries(PERF_HARNESS_MODELS).find(
    ([, model]) => model === body.model,
  )?.[0];
  if (purpose === "acceptance_semantic_validation") return semanticAcceptanceReply(messages);
  if (purpose) return harnessReply(purpose, readReplayContext(messages));
  const offered = (body.tools || []).map((tool) => tool.function?.name);
  const echo = createNamespacedToolId("mcp", MCP_TEST_SERVICE.name, "echo");
  if (offered.includes(echo)) {
    return messages.some((message) => message.role === "tool")
      ? { content: "NOOBOT-PERF-ECHO" }
      : { tool: { name: echo, args: { text: "NOOBOT-PERF-ECHO" } } };
  }
  if (
    messages.some((message) => String(message.content).includes("Initialize performance session"))
  )
    if (!messages.some((message) => JSON.stringify(message).includes("NOOBOT_PERF_CASE:")))
      return { content: "NOOBOT-PERF-INITIALIZED" };
  const { filePath, connectorId, completed, repetitions, turnKey } = readReplayContext(messages);
  const groupSize = scenarioSteps(filePath, connectorId).length;
  const steps = scenarioSteps(filePath, connectorId, Math.floor(completed / groupSize));
  const step = completed < steps.length * repetitions ? steps[completed % steps.length] : null;
  if (!step) return { content: `NOOBOT-PERF-DONE:${filePath}` };
  if (!offered.includes(step.name))
    throw new Error(
      `Required tool is not offered: ${step.name}; offered=${JSON.stringify(offered)}; choice=${body.tool_choice}`,
    );
  return { tool: step, callId: `perf_step_${completed + 1}_${turnKey}` };
}
