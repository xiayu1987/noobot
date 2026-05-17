import test from "node:test";
import assert from "node:assert/strict";

import { buildTools } from "../../../src/system-core/tools/index.js";

function createContext({ globalConfig = {}, userConfig = {}, runtimePatch = {} } = {}) {
  return {
    agentContext: {
      runtime: {
        globalConfig,
        userConfig,
        systemRuntime: {
          sessionId: "s-1",
          rootSessionId: "s-1",
          config: { allowUserInteraction: true },
        },
        ...runtimePatch,
      },
    },
  };
}

test("buildTools: 重组后应注册关键工具", async () => {
  const tools = await buildTools(createContext());
  const names = new Set(tools.map((tool) => tool?.name).filter(Boolean));

  const expected = [
    "wait",
    "read_file",
    "write_file",
    "call_service",
    "call_mcp_task",
    "process_content_task",
    "process_connector_tool",
    "delegate_task_async",
    "wait_async_task_result",
    "plan_multi_task_collaboration",
    "switch_model",
    "task_summary",
    "request_help",
    "user_interaction",
  ];

  for (const toolName of expected) {
    assert.ok(names.has(toolName), `应注册工具: ${toolName}`);
  }
});

test("buildTools: enabled=false 应按配置过滤", async () => {
  const tools = await buildTools(
    createContext({
      globalConfig: {
        tools: {
          wait: { enabled: false },
          service: { enabled: false },
          model: { enabled: false },
          process_content_task: { enabled: false },
          process_connector_tool: { enabled: false },
          request_help: { enabled: false },
          agent_collab: { enabled: false },
          user_interaction: { enabled: false },
        },
      },
    }),
  );
  const names = new Set(tools.map((tool) => tool?.name).filter(Boolean));

  const shouldBeDisabled = [
    "wait",
    "call_service",
    "switch_model",
    "process_content_task",
    "process_connector_tool",
    "request_help",
    "delegate_task_async",
    "wait_async_task_result",
    "plan_multi_task_collaboration",
    "user_interaction",
  ];

  for (const toolName of shouldBeDisabled) {
    assert.equal(names.has(toolName), false, `应被禁用: ${toolName}`);
  }

  assert.equal(names.has("read_file"), true);
  assert.equal(names.has("write_file"), true);
  assert.equal(names.has("call_mcp_task"), true);
});
