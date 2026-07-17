/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createMockBotHookManager,
  workflowDsl,
  simpleActionWorkflowDsl,
  createCapabilityModelInvoker,
  createNodeResult,
  createRecordingSubSessionRunner,
  createAttachmentPersister,
  createSemanticTransferTool,
  createBaseContext,
  createContextWithSharedTools,
  getBeforeDispatch,
  runWorkflowHook,
  callsByNodeName,
  workflowTurn,
  createRegisterWorkflowHooks,
  WORKFLOW_BOT_HOOK_POINTS,
  WORKFLOW_PLUGIN_DEFAULTS,
  resolveWorkflowNodeDialogProcessId,
  collectWorkflowDialogProcessIds,
  resolveWorkflowDialogProcessId,
} from "./helpers/workflow-hook-session-strategy-helper.js";

test("workflow hook marks failed sub-agent step and continues downstream", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const subSessionCalls = [];

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      capabilityModelInvoker: async () => ({
        output: [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=a type=action name="节点A" task="执行A"',
          'NODE id=b type=action name="节点B" task="执行B"',
          'NODE id=end type=state stateType=end name="结束"',
          "EDGE from=start to=a",
          "EDGE from=a to=b",
          "EDGE from=b to=end",
          "END",
        ].join("\n"),
      }),
      subSessionRunner: async (payload = {}) => {
        subSessionCalls.push(payload);
        const nodeName = String(payload?.metadata?.nodeName || "").trim();
        if (nodeName === "节点A") {
          throw new Error("节点A子agent失败");
        }
        return {
          sessionId: `session-${nodeName}`,
          dialogProcessId: `dialog-${nodeName}`,
          result: {
            answer: `answer-${nodeName}`,
            messages: [{ role: "assistant", content: `result-${nodeName}` }],
          },
        };
      },
      generatedArtifactPersister: async (payload = {}) => [
        {
          attachmentId: `att-${String(payload?.artifacts?.[0]?.name || "x")}`,
          name: String(payload?.artifacts?.[0]?.name || "result.md"),
          mimeType: "text/markdown",
          path: `/attachments/${String(payload?.artifacts?.[0]?.name || "result.md")}`,
        },
      ],
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  const beforeContext = {
    userId: "u1",
    sessionId: "s-failed-step",
    dialogProcessId: "d-failed-step",
    userMessage: "请运行失败继续流程",
    runConfig: { locale: "zh-CN" },
  };
  await beforeDispatch.handler(beforeContext);

  assert.equal(beforeContext.skipAgentDispatch, true);
  assert.equal(subSessionCalls.length, 2);
  const callByNodeName = callsByNodeName(subSessionCalls);
  const nodeBSystem = String(callByNodeName.get("节点B")?.systemMessages?.[0] || "");
  assert.match(nodeBSystem, /上游失败节点/);
  assert.match(nodeBSystem, /节点A子agent失败/);

  const nodeRuns = beforeContext.overrideAgentResult?.workflow?.execution?.nodeAgentRuns || [];
  const nodeARun = nodeRuns.find((item) => String(item?.step?.nodeName || "") === "节点A");
  assert.equal(nodeARun?.stepStatus, "failed");
  assert.match(String(nodeARun?.stepFailure?.message || ""), /节点A子agent失败/);
  const nodeSessionA = beforeContext.overrideAgentResult?.workflow?.nodeSessions?.find(
    (item) => String(item?.nodeName || "") === "节点A",
  );
  assert.equal(nodeSessionA?.stepStatus, "failed");
});



test("workflow hook injects failed upstream task+error from single upstream into multiple downstream nodes", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const subSessionCalls = [];

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      capabilityModelInvoker: async () => ({
        output: [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=a type=action name="节点A" task="执行A任务"',
          'NODE id=branch type=state stateType=branch name="分叉"',
          'NODE id=b type=action name="节点B" task="执行B"',
          'NODE id=c type=action name="节点C" task="执行C"',
          'NODE id=end type=state stateType=end name="结束"',
          "EDGE from=start to=a",
          "EDGE from=a to=branch",
          "EDGE from=branch to=b",
          "EDGE from=branch to=c",
          "EDGE from=b to=end",
          "EDGE from=c to=end",
          "END",
        ].join("\n"),
      }),
      subSessionRunner: async (payload = {}) => {
        subSessionCalls.push(payload);
        const nodeName = String(payload?.metadata?.nodeName || "").trim();
        if (nodeName === "节点A") throw new Error("节点A失败");
        return {
          sessionId: `session-${nodeName}`,
          dialogProcessId: `dialog-${nodeName}`,
          result: { messages: [{ role: "assistant", content: `ok-${nodeName}` }] },
        };
      },
      generatedArtifactPersister: async () => [],
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s-failure-fanout",
    dialogProcessId: "d-failure-fanout",
    userMessage: "请运行失败传播流程",
    runConfig: { locale: "zh-CN" },
  });
  const callByNodeName = callsByNodeName(subSessionCalls);
  const nodeBSystem = String(callByNodeName.get("节点B")?.systemMessages?.[0] || "");
  const nodeCSystem = String(callByNodeName.get("节点C")?.systemMessages?.[0] || "");
  assert.match(nodeBSystem, /节点A（任务：执行A任务）: 节点A失败/);
  assert.match(nodeCSystem, /节点A（任务：执行A任务）: 节点A失败/);
});



test("workflow hook injects failed upstream task+error from multiple upstream into single downstream node", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const subSessionCalls = [];

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      parallelNodeExecution: true,
      maxParallelNodeAgents: WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_PARALLEL_NODE_AGENTS,
      capabilityModelInvoker: async () => ({
        output: [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=branch type=state stateType=branch name="分叉"',
          'NODE id=a type=action name="节点A" task="执行A任务"',
          'NODE id=b type=action name="节点B" task="执行B任务"',
          'NODE id=merge type=state stateType=merge name="汇聚"',
          'NODE id=c type=action name="节点C" task="执行C任务"',
          'NODE id=end type=state stateType=end name="结束"',
          "EDGE from=start to=branch",
          "EDGE from=branch to=a",
          "EDGE from=branch to=b",
          "EDGE from=a to=merge",
          "EDGE from=b to=merge",
          "EDGE from=merge to=c",
          "EDGE from=c to=end",
          "END",
        ].join("\n"),
      }),
      subSessionRunner: async (payload = {}) => {
        subSessionCalls.push(payload);
        const nodeName = String(payload?.metadata?.nodeName || "").trim();
        if (nodeName === "节点A") throw new Error("节点A失败");
        return {
          sessionId: `session-${nodeName}`,
          dialogProcessId: `dialog-${nodeName}`,
          result: { messages: [{ role: "assistant", content: `ok-${nodeName}` }] },
        };
      },
      generatedArtifactPersister: async () => [],
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s-failure-merge",
    dialogProcessId: "d-failure-merge",
    userMessage: "请运行失败传播流程",
    runConfig: { locale: "zh-CN" },
  });
  const callByNodeName = callsByNodeName(subSessionCalls);
  const nodeCSystem = String(callByNodeName.get("节点C")?.systemMessages?.[0] || "");
  assert.match(nodeCSystem, /节点A（任务：执行A任务）: 节点A失败/);
});



test("workflow hook injects failed upstream task+error from multiple upstream into multiple downstream nodes", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const subSessionCalls = [];

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      parallelNodeExecution: true,
      maxParallelNodeAgents: WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_PARALLEL_NODE_AGENTS,
      capabilityModelInvoker: async () => ({
        output: [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=branch type=state stateType=branch name="分叉"',
          'NODE id=a type=action name="节点A" task="执行A任务"',
          'NODE id=b type=action name="节点B" task="执行B任务"',
          'NODE id=merge type=state stateType=merge name="汇聚"',
          'NODE id=branch2 type=state stateType=branch name="汇聚后分叉"',
          'NODE id=c type=action name="节点C" task="执行C任务"',
          'NODE id=d type=action name="节点D" task="执行D任务"',
          'NODE id=end type=state stateType=end name="结束"',
          "EDGE from=start to=branch",
          "EDGE from=branch to=a",
          "EDGE from=branch to=b",
          "EDGE from=a to=merge",
          "EDGE from=b to=merge",
          "EDGE from=merge to=branch2",
          "EDGE from=branch2 to=c",
          "EDGE from=branch2 to=d",
          "EDGE from=c to=end",
          "EDGE from=d to=end",
          "END",
        ].join("\n"),
      }),
      subSessionRunner: async (payload = {}) => {
        subSessionCalls.push(payload);
        const nodeName = String(payload?.metadata?.nodeName || "").trim();
        if (nodeName === "节点A") throw new Error("节点A失败");
        return {
          sessionId: `session-${nodeName}`,
          dialogProcessId: `dialog-${nodeName}`,
          result: { messages: [{ role: "assistant", content: `ok-${nodeName}` }] },
        };
      },
      generatedArtifactPersister: async () => [],
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s-failure-multi",
    dialogProcessId: "d-failure-multi",
    userMessage: "请运行失败传播流程",
    runConfig: { locale: "zh-CN" },
  });
  const callByNodeName = callsByNodeName(subSessionCalls);
  const nodeCSystem = String(callByNodeName.get("节点C")?.systemMessages?.[0] || "");
  const nodeDSystem = String(callByNodeName.get("节点D")?.systemMessages?.[0] || "");
  assert.match(nodeCSystem, /节点A（任务：执行A任务）: 节点A失败/);
  assert.match(nodeDSystem, /节点A（任务：执行A任务）: 节点A失败/);
});


