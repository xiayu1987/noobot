/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createAgentCollabTool } from "../../../src/system-core/tools/collaboration/agent-collab-tool.js";

function parseToolJson(text = "") {
  return JSON.parse(String(text || "{}"));
}

function createAgentContext({
  runConfigPassthrough = null,
  parentSafeConfirm = true,
  parentToolPolicy = null,
  parentStreamingSet = false,
  parentStreaming = false,
} = {}) {
  const parentSessionId = "11111111-1111-4111-8111-111111111111";
  const events = [];
  const runCalls = [];
  const normalizedToolPolicy =
    parentToolPolicy && typeof parentToolPolicy === "object" ? parentToolPolicy : undefined;
  const runtime = {
    userId: "primary-user",
    botManager: {
      runAsyncSession: (payload = {}) => {
        runCalls.push(payload);
        return {
          ok: true,
          status: "running",
          sessionId: payload.sessionId,
          parentSessionId: payload.parentSessionId,
          parentAsyncResultContainer: payload.parentAsyncResultContainer || null,
        };
      },
    },
    eventListener: {
      onEvent: (event = {}) => events.push(event),
    },
    systemRuntime: {
      sessionId: parentSessionId,
      dialogProcessId: "dp_parent_1",
      config: {
        allowUserInteraction: true,
        safeConfirm: parentSafeConfirm !== false,
        ...(normalizedToolPolicy ? { toolPolicy: normalizedToolPolicy } : {}),
        ...(parentStreamingSet ? { streaming: parentStreaming === true } : {}),
      },
    },
    sessionManager: {
      getSessionTree: async () => ({
        nodes: {
          [parentSessionId]: { parentSessionId: "" },
        },
      }),
      hasDialogProcessIdInSession: async () => true,
    },
    globalConfig: {
      tools: {
        ...(runConfigPassthrough ? { delegate_task_async: { runConfigPassthrough } } : {}),
      },
    },
    userConfig: {},
    sharedTools: {},
    childAsyncResultContainers: [],
  };

  return {
    agentContext: {
      userId: "primary-user",
      runtime,
    },
    events,
    runCalls,
  };
}

async function invokeDelegateTask({ agentContext }) {
  const tools = createAgentCollabTool({ agentContext });
  const delegateTool = tools.find((item) => item?.name === "delegate_task_async");
  assert.ok(delegateTool);
  const raw = await delegateTool.invoke({
    tasks: [{ taskName: "子任务A", taskContent: "完成A" }],
  });
  return parseToolJson(raw);
}

test("delegate_task_async: 默认透传 safeConfirm 且不透传 toolPolicy", async () => {
  const { agentContext, runCalls } = createAgentContext({
    parentSafeConfirm: false,
    parentToolPolicy: { allowToolNames: ["execute_script"] },
  });
  const payload = await invokeDelegateTask({ agentContext });
  assert.equal(payload.ok, true);
  assert.equal(runCalls.length, 1);
  const childRunConfig = runCalls[0]?.runConfig || {};
  assert.equal(childRunConfig.safeConfirm, false);
  assert.equal("toolPolicy" in childRunConfig, false);
});

test("delegate_task_async: 默认开启 safeConfirm", async () => {
  const { agentContext, runCalls } = createAgentContext({
    parentSafeConfirm: true,
  });
  const payload = await invokeDelegateTask({ agentContext });
  assert.equal(payload.ok, true);
  assert.equal(runCalls.length, 1);
  const childRunConfig = runCalls[0]?.runConfig || {};
  assert.equal(childRunConfig.safeConfirm, true);
});

test("delegate_task_async: 配置后透传 toolPolicy（拷贝）", async () => {
  const parentToolPolicy = {
    allowToolNames: ["execute_script", "task_summary"],
  };
  const { agentContext, runCalls } = createAgentContext({
    runConfigPassthrough: { toolPolicy: true },
    parentToolPolicy,
  });
  const payload = await invokeDelegateTask({ agentContext });
  assert.equal(payload.ok, true);
  assert.equal(runCalls.length, 1);
  const childRunConfig = runCalls[0]?.runConfig || {};
  assert.deepEqual(childRunConfig.toolPolicy, parentToolPolicy);
  assert.notStrictEqual(childRunConfig.toolPolicy, parentToolPolicy);
});


test("delegate_task_async: 透传父 runConfig 显式 streaming=false", async () => {
  const { agentContext, runCalls, events } = createAgentContext({
    parentStreamingSet: true,
    parentStreaming: false,
  });
  const payload = await invokeDelegateTask({ agentContext });
  assert.equal(payload.ok, true);
  assert.equal(runCalls.length, 1);
  const childRunConfig = runCalls[0]?.runConfig || {};
  assert.equal(childRunConfig.streaming, false);
  const passthroughEvent = events.find(
    (item = {}) => item?.event === "subagent_runconfig_passthrough_applied",
  );
  assert.equal(passthroughEvent?.data?.passthrough?.streaming, true);
  assert.equal(passthroughEvent?.data?.effectiveRunConfig?.streaming, false);
});

test("delegate_task_async: 记录 runconfig 透传事件日志", async () => {
  const parentToolPolicy = {
    allowToolNames: ["execute_script"],
  };
  const { agentContext, events } = createAgentContext({
    runConfigPassthrough: { toolPolicy: true },
    parentSafeConfirm: false,
    parentToolPolicy,
  });
  const payload = await invokeDelegateTask({ agentContext });
  assert.equal(payload.ok, true);
  const passthroughEvent = events.find(
    (item = {}) => item?.event === "subagent_runconfig_passthrough_applied",
  );
  assert.ok(passthroughEvent);
  assert.equal("safeConfirm" in (passthroughEvent.data?.passthrough || {}), false);
  assert.equal(passthroughEvent.data?.passthrough?.toolPolicy, true);
  assert.equal(passthroughEvent.data?.effectiveRunConfig?.safeConfirm, false);
  assert.equal(passthroughEvent.data?.effectiveRunConfig?.hasToolPolicy, true);
  assert.deepEqual(passthroughEvent.data?.effectiveRunConfig?.toolPolicyKeys, [
    "allowToolNames",
  ]);
  assert.equal(passthroughEvent.data?.taskCount, 1);
});
