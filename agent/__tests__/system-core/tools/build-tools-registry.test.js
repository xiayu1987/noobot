/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
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
    "read_file",
    "write_file",
    "call_service",
    "call_mcp_task",
    "process_content_task",
    "process_connector_tool",
    "switch_model",
    "task_summary",
    "request_help",
    "user_interaction",
    "web_search",
  ];

  for (const toolName of expected) {
    assert.ok(names.has(toolName), `应注册工具: ${toolName}`);
  }

  const toolByName = new Map(tools.map((tool) => [tool?.name, tool]));
  assert.deepEqual(Object.keys(toolByName.get("call_mcp_task")?.schema?.shape || {}).sort(), [
    "mcpName",
    "task",
  ]);
  assert.deepEqual(Object.keys(toolByName.get("web_search")?.schema?.shape || {}).sort(), [
    "query",
  ]);

  const hardDisabled = [
    "delegate_task_async",
    "wait_async_task_result",
    "plan_multi_task_collaboration",
  ];
  for (const toolName of hardDisabled) {
    assert.equal(names.has(toolName), false, `多 agent 协作工具不应注册: ${toolName}`);
  }
});

test("buildTools: enabled=false 应按配置过滤", async () => {
  const tools = await buildTools(
    createContext({
      globalConfig: {
        tools: {
          service: { enabled: false },
          model: { enabled: false },
          process_content_task: { enabled: false },
          process_connector_tool: { enabled: false },
          request_help: { enabled: false },
          web_search: { enabled: false },
          agent_collab: { enabled: false },
          user_interaction: { enabled: false },
        },
      },
    }),
  );
  const names = new Set(tools.map((tool) => tool?.name).filter(Boolean));

  const shouldBeDisabled = [
    "call_service",
    "switch_model",
    "process_content_task",
    "process_connector_tool",
    "request_help",
    "web_search",
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

test("buildTools: runtime toolPolicy.denyToolNames 可按统一字段禁用工具", async () => {
  const tools = await buildTools(
    createContext({
      runtimePatch: {
        runConfig: {
          toolPolicy: {
            denyToolNames: [
              "delegate_task_async",
              "wait_async_task_result",
              "plan_multi_task_collaboration",
            ],
          },
        },
      },
    }),
  );
  const names = new Set(tools.map((tool) => tool?.name).filter(Boolean));

  assert.equal(names.has("delegate_task_async"), false);
  assert.equal(names.has("wait_async_task_result"), false);
  assert.equal(names.has("plan_multi_task_collaboration"), false);
  assert.equal(names.has("request_help"), true);
  assert.equal(names.has("process_content_task"), true);
});

test("buildTools: 兼容 legacy disableAgentCollabTools 字段", async () => {
  const tools = await buildTools(
    createContext({
      runtimePatch: {
        runConfig: {
          toolPolicy: {
            disableAgentCollabTools: true,
          },
        },
      },
    }),
  );
  const names = new Set(tools.map((tool) => tool?.name).filter(Boolean));

  assert.equal(names.has("delegate_task_async"), false);
  assert.equal(names.has("wait_async_task_result"), false);
  assert.equal(names.has("plan_multi_task_collaboration"), false);
});

test("buildTools: coding 场景应强制保留编程基础工具", async () => {
  const tools = await buildTools(
    createContext({
      globalConfig: {
        tools: {
          file: { enabled: false },
          read_file: { enabled: false },
          write_file: { enabled: false },
          search: { enabled: false },
          patch_file: { enabled: false },
          execute_script: { enabled: false },
        },
      },
      runtimePatch: {
        basePath: "/tmp",
        runConfig: {
          scenario: "coding",
          toolPolicy: {
            denyToolNames: [
              "read_file",
              "write_file",
              "search",
              "patch_file",
              "execute_script",
            ],
          },
        },
      },
    }),
  );
  const names = new Set(tools.map((tool) => tool?.name).filter(Boolean));
  assert.equal(names.has("read_file"), true);
  assert.equal(names.has("write_file"), true);
  assert.equal(names.has("search"), true);
  assert.equal(names.has("patch_file"), true);
  assert.equal(names.has("execute_script"), true);
});
