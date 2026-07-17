/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { resolveScenarioProfile } from "../../../src/system-core/context/builders/scenario-resolver.js";
import {
  resolveBuiltinScenarios,
  sanitizeScenarioConfig,
} from "../../../src/system-core/config/core/builtin-scenarios.js";

test("resolveScenarioProfile prefers runConfig scenarioProfile over builtin scenario definition", () => {
  const result = resolveScenarioProfile({
    runConfig: {
      scenario: "programming",
      scenarioProfile: {
        name: "临时覆盖",
        description: "run profile",
        model: "openai:gpt-5",
        tools: [" execute_script ", ""],
      },
    },
    effectiveConfig: {
      scenarios: {
        default: "programming",
        definitions: {
          programming: {
            model: "openai:gpt-4.1",
            tools: ["unsafe_tool"],
            context: ["attachments"],
          },
        },
      },
    },
  });

  assert.equal(result.key, "programming");
  assert.equal(result.name, "临时覆盖");
  assert.equal(result.description, "run profile");
  assert.equal(result.model, "openai:gpt-5");
  assert.deepEqual(result.tools, ["execute_script"]);
  assert.deepEqual(result.context, [
    "scenario",
    "system_runtime",
    "base_prompt",
    "services",
    "mcp_servers",
  ]);
});

test("resolveScenarioProfile supports runConfig mcp aliases and ignores custom scenario definitions", () => {
  const fromRunConfig = resolveScenarioProfile({
    runConfig: {
      scenarioProfile: {
        mcp_servers: [" server-a ", "", "server-b"],
        services: [" svc.query ", null],
      },
    },
    effectiveConfig: {},
  });
  assert.deepEqual(fromRunConfig.mcpServers, ["server-a", "server-b"]);
  assert.deepEqual(fromRunConfig.services, ["svc.query"]);

  const fromDefinition = resolveScenarioProfile({
    runConfig: { scenario: "assistant" },
    effectiveConfig: {
      scenarios: {
        definitions: {
          assistant: {
            mcp_servers: [" server-c "],
          },
        },
      },
    },
  });
  assert.equal(fromDefinition.key, "assistant");
  assert.deepEqual(fromDefinition.mcpServers, []);
});

test("resolveScenarioProfile programming description mentions preferred code tools by actual names", () => {
  const result = resolveScenarioProfile({
    runConfig: { scenario: "programming" },
    effectiveConfig: {},
  });

  assert.match(result.description, /search/);
  assert.match(result.description, /read_file/);
  assert.match(result.description, /write_file/);
  assert.match(result.description, /patch_file/);
});

test("resolveScenarioProfile localizes builtin scenario names from runtime locale", () => {
  const english = resolveScenarioProfile({
    runConfig: { scenario: "programming", locale: "en-US" },
    effectiveConfig: {},
  });
  const chinese = resolveScenarioProfile({
    runConfig: { scenario: "programming", locale: "zh-CN" },
    effectiveConfig: {},
  });

  assert.equal(english.name, "Programming");
  assert.equal(chinese.name, "编程");
});

test("resolveScenarioProfile supports builtin text scenario without a hard-coded default model", () => {
  const result = resolveScenarioProfile({
    runConfig: { scenario: "text", locale: "zh-CN" },
    effectiveConfig: {},
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
    "process_content_task",
    "user_interaction",
    "task_summary",
    "request_help",
    "web_search",
  ]);
  assert.deepEqual(result.context, [
    "scenario",
    "system_runtime",
    "base_prompt",
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
