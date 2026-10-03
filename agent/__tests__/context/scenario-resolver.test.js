/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { resolveScenarioProfile } from "../../src/context/builders/scenario-resolver.js";
import {
  RunConfigResolver,
  resolveBuiltinScenarios,
  sanitizeScenarioConfig,
} from "@noobot/agent-config-protocol";

function resolveRunConfig(runConfig = {}, globalConfig = {}) {
  return new RunConfigResolver({ globalConfig }).resolveScenarioRunConfig(runConfig, {});
}

test("resolveScenarioProfile only consumes runConfig.scenarioProfile", () => {
  const result = resolveScenarioProfile({
    runConfig: {
      scenarioProfile: {
        key: "custom",
        name: "临时",
        description: "run profile",
        model: "openai:gpt-5",
        tools: ["execute_script"],
        context: ["scenario"],
        services: ["svc.query"],
        mcpServers: ["server-a"],
      },
    },
  });

  assert.deepEqual(result, {
    key: "custom",
    name: "临时",
    description: "run profile",
    model: "openai:gpt-5",
    tools: ["execute_script"],
    context: ["scenario"],
    services: ["svc.query"],
    mcpServers: ["server-a"],
  });
  assert.deepEqual(resolveScenarioProfile({ runConfig: { scenario: "programming" } }), {});
});

test("resolveScenarioProfile programming description mentions preferred code tools by actual names", () => {
  const result = resolveScenarioProfile({
    runConfig: resolveRunConfig({ scenario: "programming" }),
  });

  assert.match(result.description, /search/);
  assert.match(result.description, /read_file/);
  assert.match(result.description, /write_file/);
  assert.match(result.description, /patch_file/);
});

test("resolveScenarioProfile localizes builtin scenario names from runtime locale", () => {
  const english = resolveScenarioProfile({
    runConfig: resolveRunConfig({ scenario: "programming", locale: "en-US" }),
  });
  const chinese = resolveScenarioProfile({
    runConfig: resolveRunConfig({ scenario: "programming", locale: "zh-CN" }),
  });

  assert.equal(english.name, "Programming");
  assert.equal(chinese.name, "编程");
});

test("resolveScenarioProfile supports builtin text scenario without a hard-coded default model", () => {
  const result = resolveScenarioProfile({
    runConfig: resolveRunConfig({ scenario: "text", locale: "zh-CN" }),
  });

  assert.equal(result.key, "text");
  assert.equal(result.name, "文本");
  assert.equal(result.description, "文本情景：适合写作、改写、摘要、翻译与内容整理。");
  assert.equal(result.model, "");
  assert.deepEqual(result.tools, [
    "read_file",
    "write_file",
    "search",
    "patch_file",
    "execute_script",
    "execute_native_script",
    "multimodal_generate",
    "multimodal_parse",
    "access_connector",
    "user_interaction",
    "task_summary",
    "task_check",
    "help",
    "web_search",
  ]);
  assert.deepEqual(result.context, [
    "scenario",
    "system_runtime",
    "base_prompt",
    "long_memory",
    "services",
    "mcp_servers",
  ]);
  assert.deepEqual(result.services, []);
  assert.deepEqual(result.mcpServers, []);
});

test("sanitizeScenarioConfig keeps only configured text model and ignores text tool overrides", () => {
  const sanitized = sanitizeScenarioConfig({
    default: "text",
    definitions: {
      text: {
        model: " custom text model ",
        tools: ["unsafe_tool"],
        context: ["attachments"],
      },
    },
  });

  assert.deepEqual(sanitized, {
    default: "text",
    definitions: {
      text: { model: " custom text model " },
    },
  });
});

test("resolveBuiltinScenarios resolves text model from config like programming", () => {
  const result = resolveBuiltinScenarios(
    { definitions: { text: { model: "global-text-model" } } },
    { definitions: { text: { model: "user-text-model" } } },
  );

  assert.equal(result.definitions.text.model, "user-text-model");
  assert.equal(result.definitions.programming.model, "");
});
