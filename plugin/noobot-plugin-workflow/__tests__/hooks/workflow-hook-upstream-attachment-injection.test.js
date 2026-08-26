/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HOOK_POINT } from "@noobot/hook-protocol";

import {
  createMockBotHookManager,
  workflowDsl,
  simpleActionWorkflowDsl,
  createCapabilityModelInvoker,
  createNodeResult,
  createRecordingSubSessionRunner,
  createAttachmentPersister,
  createSemanticTransferTool,
  createV2AttachmentTransferEnvelope,
  createBaseContext,
  createContextWithSharedTools,
  getBeforeDispatch,
  runWorkflowHook,
  callsByNodeName,
  workflowTurn,
  createRegisterWorkflowHooks,
  WORKFLOW_PLUGIN_DEFAULTS,
  resolveWorkflowNodeDialogProcessId,
  collectWorkflowDialogProcessIds,
  resolveWorkflowDialogProcessId,
} from "../helpers/workflow-hook-session-strategy-helper.js";

test("workflow hook injects upstream node result attachments into downstream sub-session system messages", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const subSessionCalls = [];
  const semanticTransferCalls = [];
  const artifactCounter = 0;

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      parallelNodeExecution: true,
      maxParallelNodeAgents: WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_PARALLEL_NODE_AGENTS,
      resolveModelMessages: () => [],
      capabilityModelInvoker: async () => ({
        output: { text: [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=a type=action name="节点A" task="执行A"',
          'NODE id=branch type=state stateType=branch name="并发分叉"',
          'NODE id=b type=action name="节点B" task="执行B"',
          'NODE id=c type=action name="节点C" task="执行C"',
          'NODE id=merge type=state stateType=merge name="汇聚"',
          'NODE id=branch2 type=state stateType=branch name="汇聚后并发分叉"',
          'NODE id=d type=action name="节点D" task="执行D"',
          'NODE id=e type=action name="节点E" task="执行E"',
          'NODE id=end type=state stateType=end name="结束"',
          "EDGE from=start to=a",
          "EDGE from=a to=branch",
          "EDGE from=branch to=b",
          "EDGE from=branch to=c",
          "EDGE from=b to=merge",
          "EDGE from=c to=merge",
          "EDGE from=merge to=branch2",
          "EDGE from=branch2 to=d",
          "EDGE from=branch2 to=e",
          "EDGE from=d to=end",
          "EDGE from=e to=end",
          "END",
        ].join("\n") },
      }),
      subSessionRunner: async (payload = {}) => {
        const systemMessages = await payload.systemMessageFactory?.({
          attachments: payload.attachments,
        });
        subSessionCalls.push({ ...payload, systemMessages });
        const nodeName = String(payload?.metadata?.nodeName || payload?.message || "").trim();
        return {
          lifecycle: {
            executionId: payload?.strategy?.executionId || payload?.metadata?.executionId,
            executionKind: "agent",
            state: "completed",
            revision: 4,
            sequence: 4,
          },
          sessionId: `session-${nodeName}`,
          dialogProcessId: `dialog-${nodeName}`,
          result: {
            answer: `answer-${nodeName}`,
            messages: [{ role: "assistant", content: `result-${nodeName}` }],
          },
        };
      },
      generatedArtifactPersister: undefined,
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s-upstream",
    dialogProcessId: "d-upstream",
    userMessage: "请运行带并发和汇聚的流程",
    runConfig: { locale: "zh-CN" },
    agentContext: {
      execution: {
        controllers: {
          runtime: {
            sharedTools: {
              semanticTransfer: createSemanticTransferTool({
                prefix: "att",
                sessionId: "s-upstream",
                calls: semanticTransferCalls,
              }),
            },
          },
        },
      },
    },
  });

  const callByNodeName = callsByNodeName(subSessionCalls);
  assert.equal(subSessionCalls.length, 5);
  assert.deepEqual(callByNodeName.get("节点A")?.systemMessages || [], []);

  const nodeBSystem = String(callByNodeName.get("节点B")?.systemMessages?.[0] || "");
  const nodeCSystem = String(callByNodeName.get("节点C")?.systemMessages?.[0] || "");
  assert.match(nodeBSystem, /上游工作流节点结果附件/);
  assert.match(nodeBSystem, /节点A/);
  assert.match(
    nodeBSystem,
    /attachment:v1:s-upstream\/model\/att-1/,
  );
  assert.match(nodeCSystem, /节点A/);

  const nodeDSystem = String(callByNodeName.get("节点D")?.systemMessages?.[0] || "");
  assert.match(nodeDSystem, /节点B/);
  assert.match(nodeDSystem, /节点C/);
  assert.doesNotMatch(nodeDSystem, /节点A \/ workflow-node-1-节点A-result\.md/);

  const nodeESystem = String(callByNodeName.get("节点E")?.systemMessages?.[0] || "");
  assert.match(nodeESystem, /节点B/);
  assert.match(nodeESystem, /节点C/);
  assert.doesNotMatch(nodeESystem, /节点A \/ workflow-node-1-节点A-result\.md/);
  assert.equal(
    semanticTransferCalls.some((item = {}) => String(item?.strategy || "") === "workflow_subagent"),
    true,
  );
});

test("workflow hook injects one upstream action attachments into multiple direct downstream action nodes", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const subSessionCalls = [];
  const artifactCounter = 0;

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      parallelNodeExecution: true,
      maxParallelNodeAgents: WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_PARALLEL_NODE_AGENTS,
      resolveModelMessages: () => [],
      capabilityModelInvoker: async () => ({
        output: { text: [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=a type=action name="节点A" task="执行A"',
          'NODE id=b type=action name="节点B" task="执行B"',
          'NODE id=c type=action name="节点C" task="执行C"',
          'NODE id=end type=state stateType=end name="结束"',
          "EDGE from=start to=a",
          "EDGE from=a to=b",
          "EDGE from=a to=c",
          "EDGE from=b to=end",
          "EDGE from=c to=end",
          "END",
        ].join("\n") },
      }),
      subSessionRunner: async (payload = {}) => {
        const systemMessages = await payload.systemMessageFactory?.({
          attachments: payload.attachments,
        });
        subSessionCalls.push({ ...payload, systemMessages });
        const nodeName = String(payload?.metadata?.nodeName || payload?.message || "").trim();
        return {
          lifecycle: {
            executionId: payload?.strategy?.executionId || payload?.metadata?.executionId,
            executionKind: "agent",
            state: "completed",
            revision: 4,
            sequence: 4,
          },
          sessionId: `session-${nodeName}`,
          dialogProcessId: `dialog-${nodeName}`,
          result: {
            answer: `answer-${nodeName}`,
            messages: [{ role: "assistant", content: `result-${nodeName}` }],
          },
        };
      },
      generatedArtifactPersister: undefined,
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  await beforeDispatch.handler({
    userId: "u1",
    sessionId: "s-fanout",
    dialogProcessId: "d-fanout",
    userMessage: "请运行直接多下游流程",
    runConfig: { locale: "zh-CN" },
    agentContext: {
      execution: {
        controllers: {
          runtime: {
            sharedTools: {
              semanticTransfer: createSemanticTransferTool({
                prefix: "fanout-att",
                sessionId: "s-fanout",
              }),
            },
          },
        },
      },
    },
  });

  const callByNodeName = callsByNodeName(subSessionCalls);
  assert.equal(subSessionCalls.length, 3);
  assert.deepEqual(callByNodeName.get("节点A")?.systemMessages || [], []);

  const nodeBSystem = String(callByNodeName.get("节点B")?.systemMessages?.[0] || "");
  const nodeCSystem = String(callByNodeName.get("节点C")?.systemMessages?.[0] || "");
  assert.match(nodeBSystem, /节点A/);
  assert.match(
    nodeBSystem,
    /attachment:v1:s-fanout\/model\/fanout-att-1/,
  );
  assert.match(nodeCSystem, /节点A/);
  assert.match(
    nodeCSystem,
    /attachment:v1:s-fanout\/model\/fanout-att-1/,
  );
});
