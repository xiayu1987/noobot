/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash } from "node:crypto";
import { characterSteps, PERF_PLUGIN_TOOLS } from "./character-scenario.mjs";

export const MOCK_MODEL = Object.freeze({
  hostname: "noobot-mock-model",
  port: 8081,
  alias: "e2e_mock",
});
export const PERF_SCENARIO = "all-tools-v4";
export const PERF_REPETITIONS = 6;
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
  "task_summary",
]);
export const PERF_EXCLUSIONS = Object.freeze({});
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

function replayProgress(messages) {
  let completed = 0;
  for (const message of messages) {
    const content = JSON.stringify(message);
    for (const match of content.matchAll(/NOOBOT_PERF_PROGRESS:(\d+)/g))
      completed = Math.max(completed, Number(match[1]));
    const steps = (message.tool_calls || []).map(
      (call) => Number(call.id?.match(/^perf_step_(\d+)_[a-f0-9]{8}$/)?.[1]) || 0,
    );
    completed = Math.max(completed, ...steps);
  }
  return completed;
}

function summaryRequired(body, offered, messages) {
  const lastContent = JSON.stringify(messages.at(-1)?.content || "");
  return (
    body.tool_choice?.function?.name === "task_summary" ||
    (offered.length === 1 && offered[0] === "task_summary") ||
    lastContent.includes("The phase-summary threshold is reached.") ||
    lastContent.includes("阶段小结阈值")
  );
}

export function nextReply(body) {
  const messages = body.messages || [];
  const offered = (body.tools || []).map((tool) => tool.function?.name);
  const echo = offered.find((name) => name?.includes("echo"));
  if (echo) {
    return messages.some((message) => message.role === "tool")
      ? { content: "NOOBOT-PERF-ECHO" }
      : { tool: { name: echo, args: { text: "NOOBOT-PERF-ECHO" } } };
  }
  const start = messages.findLastIndex(
    (message) =>
      message.role === "user" && JSON.stringify(message.content).includes("NOOBOT_PERF_CASE:"),
  );
  if (start < 0) return { content: "NOOBOT-PERF-OK" };
  const serialized =
    typeof messages[start].content === "string"
      ? messages[start].content
      : JSON.stringify(messages[start].content);
  const marker = serialized.match(/NOOBOT_PERF_CASE:([A-Za-z0-9_./-]+)/);
  if (!marker || !/^runtime\/ops_workdir\/e2e-[A-Za-z0-9_-]+\/perf-[1-6]\.txt$/.test(marker[1])) {
    throw new Error("Invalid performance scenario path");
  }
  const connectorId = serialized.match(/NOOBOT_PERF_CONNECTOR:([A-Za-z0-9_-]+)/)?.[1];
  const completed = replayProgress(messages.slice(start));
  const groupSize = scenarioSteps(marker[1], connectorId).length;
  const steps = scenarioSteps(marker[1], connectorId, Math.floor(completed / groupSize));
  if (summaryRequired(body, offered, messages)) {
    return {
      tool: {
        name: "task_summary",
        args: {
          summaryContent: `NOOBOT_TASK_SUMMARY/1\n[STATE]\nCONTINUE\n[ABSTRACT]\nPerformance replay\n[DETAILS]\nNOOBOT_PERF_PROGRESS:${completed}\nNOOBOT_PERF_CASE:${marker[1]}\nNOOBOT_PERF_CONNECTOR:${connectorId}\n[NEXT_ACTION]\nContinue deterministic replay`,
        },
      },
    };
  }
  const step = completed < steps.length * PERF_REPETITIONS ? steps[completed % steps.length] : null;
  if (!step) return { content: `NOOBOT-PERF-DONE:${marker[1]}` };
  if (!offered.includes(step.name))
    throw new Error(
      `Required tool is not offered: ${step.name}; offered=${JSON.stringify(offered)}; choice=${body.tool_choice}`,
    );
  const turnKey = createHash("sha256").update(marker[1]).digest("hex").slice(0, 8);
  return { tool: step, callId: `perf_step_${completed + 1}_${turnKey}` };
}
