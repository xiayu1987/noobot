import test from "node:test";
import assert from "node:assert/strict";

import { createWaitTool } from "../../../src/system-core/tools/workflow/wait-tool.js";
import { createContentProcessTool } from "../../../src/system-core/tools/data-processing/content-process-tool.js";
import { createModelTool } from "../../../src/system-core/tools/ai-models/model-tool.js";
import { createServiceTool } from "../../../src/system-core/tools/execution/service-tool.js";
import { createConnectorAccessTool } from "../../../src/system-core/tools/connectors/connector-access-tool.js";

function buildAgentContext(runtime = {}) {
  return {
    agentContext: {
      runtime: {
        globalConfig: {},
        userConfig: {},
        systemRuntime: {
          sessionId: "s-1",
          rootSessionId: "s-1",
          config: {},
        },
        ...runtime,
      },
    },
  };
}

test("工具初始化 smoke: workflow/data-processing/ai/execution/connectors", async () => {
  const waitTools = createWaitTool(buildAgentContext());
  assert.equal(waitTools[0]?.name, "wait");

  const contentTools = createContentProcessTool(buildAgentContext());
  assert.equal(contentTools[0]?.name, "process_content_task");

  const modelTools = createModelTool(buildAgentContext());
  assert.ok(modelTools.some((tool) => tool?.name === "switch_model"));

  const serviceTools = createServiceTool(buildAgentContext({ userId: "u1" }));
  assert.equal(serviceTools[0]?.name, "call_service");

  const connectorTools = createConnectorAccessTool(buildAgentContext());
  assert.equal(connectorTools[0]?.name, "process_connector_tool");
});
