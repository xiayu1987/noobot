import test from "node:test";
import assert from "node:assert/strict";

import { resolveScenarioProfile } from "../../../src/system-core/context/builders/scenario-resolver.js";

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
