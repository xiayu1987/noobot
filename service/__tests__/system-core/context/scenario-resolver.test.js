import test from "node:test";
import assert from "node:assert/strict";

import { resolveScenarioProfile } from "../../../system-core/context/builders/scenario-resolver.js";

test("resolveScenarioProfile prefers runConfig scenarioProfile over scenario definition", () => {
  const result = resolveScenarioProfile({
    runConfig: {
      scenario: "coding",
      scenarioProfile: {
        name: "临时覆盖",
        description: "run profile",
        model: "openai:gpt-5",
        tools: [" execute_script ", ""],
      },
    },
    effectiveConfig: {
      scenarios: {
        default: "coding",
        definitions: {
          coding: {
            name: "编码",
            description: "definition",
            model: "openai:gpt-4.1",
            tools: ["call_service"],
            context: ["system_runtime"],
          },
        },
      },
    },
  });

  assert.equal(result.key, "coding");
  assert.equal(result.name, "临时覆盖");
  assert.equal(result.description, "run profile");
  assert.equal(result.model, "openai:gpt-5");
  assert.deepEqual(result.tools, ["execute_script"]);
  assert.deepEqual(result.context, ["system_runtime"]);
});

test("resolveScenarioProfile supports mcpServers/mcp_servers and normalizes string arrays", () => {
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
  assert.deepEqual(fromDefinition.mcpServers, ["server-c"]);
});
