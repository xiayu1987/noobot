import test from "node:test";
import assert from "node:assert/strict";

import { RunConfigResolver } from "../../../src/system-core/bot-manage/config/run-config-resolver.js";

test("applyRunConfigToolPolicy should keep final_answer tool when forceTool is enabled", () => {
  const resolver = new RunConfigResolver();
  const agentContext = {
    payload: {
      tools: {
        registry: [{ name: "final_answer" }, { name: "wait" }],
      },
    },
  };
  const runConfig = {
    forceTool: true,
    toolPolicy: {
      allowToolNames: ["wait"],
    },
  };

  const nextContext = resolver.applyRunConfigToolPolicy(agentContext, runConfig);
  const toolNames = (nextContext?.payload?.tools?.registry || []).map((tool) => tool.name);

  assert.deepEqual(toolNames.sort(), ["final_answer", "wait"]);
});

test("applyRunConfigToolPolicy should not force keep final_answer tool when forceTool is disabled", () => {
  const resolver = new RunConfigResolver();
  const agentContext = {
    payload: {
      tools: {
        registry: [{ name: "final_answer" }, { name: "wait" }],
      },
    },
  };
  const runConfig = {
    forceTool: false,
    toolPolicy: {
      allowToolNames: ["wait"],
    },
  };

  const nextContext = resolver.applyRunConfigToolPolicy(agentContext, runConfig);
  const toolNames = (nextContext?.payload?.tools?.registry || []).map((tool) => tool.name);

  assert.deepEqual(toolNames, ["wait"]);
});

test("applyRunConfigToolPolicy should support denyToolNames as unified runtime field", () => {
  const resolver = new RunConfigResolver();
  const agentContext = {
    payload: {
      tools: {
        registry: [
          { name: "wait" },
          { name: "read_file" },
          { name: "delegate_task_async" },
        ],
      },
    },
  };
  const runConfig = {
    toolPolicy: {
      denyToolNames: ["delegate_task_async", "wait"],
    },
  };

  const nextContext = resolver.applyRunConfigToolPolicy(agentContext, runConfig);
  const toolNames = (nextContext?.payload?.tools?.registry || []).map((tool) => tool.name);

  assert.deepEqual(toolNames, ["read_file"]);
});

test("applyRunConfigToolPolicy denyToolNames should override allowToolNames", () => {
  const resolver = new RunConfigResolver();
  const agentContext = {
    payload: {
      tools: {
        registry: [{ name: "wait" }, { name: "read_file" }],
      },
    },
  };
  const runConfig = {
    toolPolicy: {
      allowToolNames: ["wait", "read_file"],
      denyToolNames: ["wait"],
    },
  };

  const nextContext = resolver.applyRunConfigToolPolicy(agentContext, runConfig);
  const toolNames = (nextContext?.payload?.tools?.registry || []).map((tool) => tool.name);

  assert.deepEqual(toolNames, ["read_file"]);
});
