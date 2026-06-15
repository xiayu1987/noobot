import test from "node:test";
import assert from "node:assert/strict";

import { RunConfigResolver } from "../../../src/system-core/bot-manage/config/run-config-resolver.js";

test("applyRunConfigToolPolicy should keep final_answer tool when forceTool is enabled", () => {
  const resolver = new RunConfigResolver();
  const agentContext = {
    payload: {
      tools: {
        registry: [{ name: "final_answer" }, { name: "read_file" }],
      },
    },
  };
  const runConfig = {
    forceTool: true,
    toolPolicy: {
      allowToolNames: ["read_file"],
    },
  };

  const nextContext = resolver.applyRunConfigToolPolicy(agentContext, runConfig);
  const toolNames = (nextContext?.payload?.tools?.registry || []).map((tool) => tool.name);

  assert.deepEqual(toolNames.sort(), ["final_answer", "read_file"]);
});

test("applyRunConfigToolPolicy should not force keep final_answer tool when forceTool is disabled", () => {
  const resolver = new RunConfigResolver();
  const agentContext = {
    payload: {
      tools: {
        registry: [{ name: "final_answer" }, { name: "read_file" }],
      },
    },
  };
  const runConfig = {
    forceTool: false,
    toolPolicy: {
      allowToolNames: ["read_file"],
    },
  };

  const nextContext = resolver.applyRunConfigToolPolicy(agentContext, runConfig);
  const toolNames = (nextContext?.payload?.tools?.registry || []).map((tool) => tool.name);

  assert.deepEqual(toolNames, ["read_file"]);
});

test("applyRunConfigToolPolicy should support denyToolNames as unified runtime field", () => {
  const resolver = new RunConfigResolver();
  const agentContext = {
    payload: {
      tools: {
        registry: [
          { name: "read_file" },
          { name: "read_file" },
          { name: "delegate_task_async" },
        ],
      },
    },
  };
  const runConfig = {
    toolPolicy: {
      denyToolNames: ["delegate_task_async", "read_file"],
    },
  };

  const nextContext = resolver.applyRunConfigToolPolicy(agentContext, runConfig);
  const toolNames = (nextContext?.payload?.tools?.registry || []).map((tool) => tool.name);

  assert.deepEqual(toolNames, []);
});

test("applyRunConfigToolPolicy denyToolNames should override allowToolNames", () => {
  const resolver = new RunConfigResolver();
  const agentContext = {
    payload: {
      tools: {
        registry: [{ name: "execute_script" }, { name: "read_file" }],
      },
    },
  };
  const runConfig = {
    toolPolicy: {
      allowToolNames: ["execute_script", "read_file"],
      denyToolNames: ["execute_script"],
    },
  };

  const nextContext = resolver.applyRunConfigToolPolicy(agentContext, runConfig);
  const toolNames = (nextContext?.payload?.tools?.registry || []).map((tool) => tool.name);

  assert.deepEqual(toolNames, ["read_file"]);
});

test("applyRunConfigToolPolicy should keep coding-required tools in coding scenario", () => {
  const resolver = new RunConfigResolver();
  const agentContext = {
    payload: {
      tools: {
        registry: [
          { name: "read_file" },
          { name: "write_file" },
          { name: "search" },
          { name: "patch_file" },
          { name: "execute_script" },
          { name: "request_help" },
        ],
      },
    },
  };
  const runConfig = {
    scenario: "coding",
    toolPolicy: {
      mode: "custom_only",
      customTools: [{ name: "request_help" }],
      allowToolNames: ["request_help"],
      denyToolNames: [
        "read_file",
        "write_file",
        "search",
        "patch_file",
        "execute_script",
      ],
    },
  };

  const nextContext = resolver.applyRunConfigToolPolicy(agentContext, runConfig);
  const toolNames = (nextContext?.payload?.tools?.registry || [])
    .map((tool) => tool.name)
    .sort();

  assert.deepEqual(toolNames, [
    "execute_script",
    "patch_file",
    "read_file",
    "request_help",
    "search",
    "write_file",
  ]);
});

test("resolveScenarioRunConfig should use builtin programming shape and only accept model override", () => {
  const resolver = new RunConfigResolver({
    globalConfig: {
      scenarios: {
        definitions: {
          programming: {
            model: "code-model",
            tools: ["unsafe_tool"],
            context: ["*"],
            services: ["custom_service"],
          },
          custom: { name: "custom" },
        },
      },
    },
  });

  const resolved = resolver.resolveScenarioRunConfig({ scenario: "programming" }, {});

  assert.equal(resolved.runtimeModel, "code-model");
  assert.equal(resolved.scenarioProfile.name, "编程");
  assert.deepEqual(resolved.scenarioProfile.tools, [
    "read_file",
    "write_file",
    "search",
    "patch_file",
    "execute_script",
    "process_content_task",
    "task_summary",
    "request_help",
    "call_service",
  ]);
  assert.deepEqual(resolved.scenarioProfile.context, [
    "scenario",
    "system_runtime",
    "base_prompt",
    "services",
    "mcp_servers",
  ]);
  assert.deepEqual(resolved.scenarioProfile.services, ["web_search_service"]);
});
