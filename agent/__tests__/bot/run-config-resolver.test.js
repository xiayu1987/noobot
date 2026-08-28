/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { RunConfigResolver, resolveToolBindings } from "@noobot/agent-config-protocol";

test("resolveToolBindings should only keep tools allowed by runtime policy", () => {
  const agentContext = {
    bindings: { tools: [{ name: "final_answer" }, { name: "read_file" }] },
  };
  const runConfig = {
    safeConfirm: true,
    toolPolicy: {
      allowToolNames: ["read_file"],
    },
  };

  const toolNames = resolveToolBindings({
    sourceTools: agentContext.bindings.tools,
    runConfig,
  }).map((tool) => tool.name);

  assert.deepEqual(toolNames, ["read_file"]);
});

test("resolveToolBindings should not force keep final_answer when safety confirmation is disabled", () => {
  const agentContext = {
    bindings: { tools: [{ name: "final_answer" }, { name: "read_file" }] },
  };
  const runConfig = {
    safeConfirm: false,
    toolPolicy: {
      allowToolNames: ["read_file"],
    },
  };

  const toolNames = resolveToolBindings({
    sourceTools: agentContext.bindings.tools,
    runConfig,
  }).map((tool) => tool.name);

  assert.deepEqual(toolNames, ["read_file"]);
});

test("resolveToolBindings should support denyToolNames as unified runtime field", () => {
  const agentContext = {
    bindings: {
      tools: [{ name: "read_file" }, { name: "read_file" }, { name: "delegate_task_async" }],
    },
  };
  const runConfig = {
    toolPolicy: {
      denyToolNames: ["delegate_task_async", "read_file"],
    },
  };

  const toolNames = resolveToolBindings({
    sourceTools: agentContext.bindings.tools,
    runConfig,
  }).map((tool) => tool.name);

  assert.deepEqual(toolNames, []);
});

test("resolveToolBindings denyToolNames should override allowToolNames", () => {
  const agentContext = {
    bindings: { tools: [{ name: "execute_script" }, { name: "read_file" }] },
  };
  const runConfig = {
    toolPolicy: {
      allowToolNames: ["execute_script", "read_file"],
      denyToolNames: ["execute_script"],
    },
  };

  const toolNames = resolveToolBindings({
    sourceTools: agentContext.bindings.tools,
    runConfig,
  }).map((tool) => tool.name);

  assert.deepEqual(toolNames, ["read_file"]);
});

test("resolveToolBindings should keep custom_only as the complete tool boundary", () => {
  const agentContext = {
    bindings: {
      tools: [
        { name: "read_file" },
        { name: "write_file" },
        { name: "search" },
        { name: "patch_file" },
        { name: "execute_script" },
        { name: "request_help" },
      ],
    },
  };
  const runConfig = {
    scenario: "coding",
    toolPolicy: {
      mode: "custom_only",
      customTools: [{ name: "request_help" }],
      allowToolNames: ["request_help"],
      denyToolNames: ["read_file", "write_file", "search", "patch_file", "execute_script"],
    },
  };

  const toolNames = resolveToolBindings({
    sourceTools: agentContext.bindings.tools,
    runConfig,
  })
    .map((tool) => tool.name)
    .sort();

  assert.deepEqual(toolNames, ["request_help"]);
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

  assert.equal(resolved.runtimeModel, undefined);
  assert.equal(resolved.scenarioProfile.name, "编程");
  assert.equal(resolved.scenarioProfile.model, "code-model");
  assert.deepEqual(resolved.scenarioProfile.tools, [
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
    "request_help",
    "web_search",
  ]);
  assert.deepEqual(resolved.scenarioProfile.context, [
    "scenario",
    "system_runtime",
    "base_prompt",
    "long_memory",
    "services",
    "mcp_servers",
  ]);
  assert.deepEqual(resolved.contextPolicy.promptSections, [
    "scenario",
    "system_runtime",
    "base_prompt",
    "long_memory",
    "services",
    "mcp_servers",
  ]);
  assert.deepEqual(resolved.scenarioProfile.services, []);
});

test("resolveScenarioRunConfig should preserve wildcard context selection for full scenario", () => {
  const resolver = new RunConfigResolver({ globalConfig: {} });
  const resolved = resolver.resolveScenarioRunConfig({ scenario: "full" }, {});

  assert.deepEqual(resolved.scenarioProfile.context, ["*"]);
  assert.deepEqual(resolved.contextPolicy.promptSections, ["*"]);
});

test("programming and text scenarios expose the selected connector access boundary", () => {
  const resolver = new RunConfigResolver({ globalConfig: {} });
  const sourceTools = [
    { name: "read_file" },
    { name: "access_connector" },
    { name: "call_service" },
  ];

  for (const scenario of ["programming", "text"]) {
    const runConfig = resolver.resolveScenarioRunConfig({ scenario }, {});
    const toolNames = resolveToolBindings({ sourceTools, runConfig }).map((tool) => tool.name);

    assert.deepEqual(toolNames, ["read_file", "access_connector"]);
    assert.equal(runConfig.scenarioProfile.tools.includes("access_connector"), true);
  }
});

test("resolveScenarioRunConfig should keep selectedModel separate from runtimeModel", () => {
  const resolver = new RunConfigResolver({
    globalConfig: {
      scenarios: {
        definitions: {
          programming: {
            model: "code-model",
          },
        },
      },
    },
  });

  const resolved = resolver.resolveScenarioRunConfig(
    {
      scenario: "programming",
      selectedModel: "user-selected-model",
      config: { selectedModel: "config-selected-model" },
    },
    {},
  );

  assert.equal(resolved.selectedModel, "user-selected-model");
  assert.equal(resolved.config?.selectedModel, "config-selected-model");
  assert.equal(resolved.scenarioProfile?.model, "code-model");
  assert.equal(resolved.runtimeModel, undefined);
});

test("custom_only should not inherit tools from any scenario", () => {
  const resolver = new RunConfigResolver({
    globalConfig: {
      scenarios: {
        definitions: {
          full: { tools: ["read_file", "multimodal_parse"] },
          programming: {
            tools: ["read_file", "multimodal_parse"],
          },
          text: { tools: ["write_file", "call_mcp_task"] },
          custom: { tools: ["execute_script", "access_connector"] },
        },
      },
    },
  });
  for (const scenario of ["full", "programming", "text", "custom", "missing"]) {
    const customTool = { name: `${scenario}_tool`, invoke: async () => "ok" };
    const resolved = resolver.resolveScenarioRunConfig(
      {
        ...(scenario === "missing" ? {} : { scenario }),
        toolPolicy: { mode: "custom_only", customTools: [customTool] },
      },
      {},
    );
    const context = {
      bindings: {
        tools: [
          customTool,
          { name: "read_file" },
          { name: "write_file" },
          { name: "multimodal_parse" },
          { name: "call_mcp_task" },
          { name: "access_connector" },
        ],
      },
    };
    const tools = resolveToolBindings({
      sourceTools: context.bindings.tools,
      runConfig: resolved,
    });
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [`${scenario}_tool`],
    );
  }
});

test("resolveScenarioRunConfig should preserve explicit runtimeModel", () => {
  const resolver = new RunConfigResolver({
    globalConfig: {
      scenarios: {
        definitions: {
          programming: {
            model: "code-model",
          },
        },
      },
    },
  });

  const resolved = resolver.resolveScenarioRunConfig(
    {
      scenario: "programming",
      runtimeModel: " explicit-runtime-model ",
      selectedModel: "frontend-model",
      config: { selectedModel: "frontend-model" },
    },
    {},
  );

  assert.equal(resolved.runtimeModel, "explicit-runtime-model");
  assert.equal(resolved.selectedModel, "frontend-model");
});

test("resolveScenarioRunConfig should remove denied tools from allowToolNames", () => {
  const resolver = new RunConfigResolver({
    globalConfig: {
      scenarios: {
        definitions: {
          programming: {
            tools: ["read_file", "task_summary", "execute_script"],
          },
        },
      },
    },
  });

  const resolved = resolver.resolveScenarioRunConfig(
    {
      scenario: "programming",
      toolPolicy: {
        allowToolNames: ["read_file", "task_summary", "execute_script"],
        denyToolNames: ["task_summary"],
      },
    },
    {},
  );

  assert.deepEqual(resolved.toolPolicy.allowToolNames, ["read_file", "execute_script"]);
  assert.deepEqual(resolved.toolPolicy.denyToolNames, ["task_summary"]);
});
