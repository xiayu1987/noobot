/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createMockBotHookManager,
  getBeforeDispatch,
  callsByNodeName,
  registerWorkflowAgentHooks,
  WORKFLOW_PLUGIN_DEFAULTS,
} from "../helpers/workflow-hook-session-strategy-helper.js";
import { createInMemoryWorkflowNodeStateRepository } from "../../src/core/orchestrator/node-state-repository.js";

function assertWorkflowFailedWithoutSuccessfulResult({
  ctx,
  outcome,
  subSessionCalls,
  forbiddenNodes = [],
} = {}) {
  assert.equal(outcome?.disposition, "handled");
  assert.equal(outcome?.owner, "workflow");
  assert.equal(outcome?.failure?.code, "detached_sub_session_failed");
  assert.equal(Object.hasOwn(outcome || {}, "result"), false);
  assert.equal(Object.hasOwn(ctx || {}, "overrideAgentResult"), false);
  assert.equal(Object.hasOwn(ctx || {}, "skipAgentDispatch"), false);

  const calls = callsByNodeName(subSessionCalls);
  for (const nodeName of forbiddenNodes) {
    assert.equal(calls.has(nodeName), false, `${nodeName} must not execute after workflow failure`);
  }
}

test("workflow hook fails the parent workflow and stops downstream after a sub-agent failure", async () => {
  const hookManager = createMockBotHookManager();
  const subSessionCalls = [];

  registerWorkflowAgentHooks({
    hookManager,
    config: {
      enabled: true,
      mode: "on",
      resolveModelMessages: () => [],
      capabilityModelInvoker: async () => ({
        output: {
          text: [
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
        },
      }),
      subSessionRunner: async (payload = {}) => {
        subSessionCalls.push(payload);
        const nodeName = String(payload?.metadata?.nodeName || "").trim();
        if (nodeName === "节点A") {
          {
            const error = new Error("节点A子agent失败");
            error.lifecycle = {
              executionId: payload.strategy.executionId,
              executionKind: "agent",
              state: "processing_failed",
              revision: 3,
              sequence: 3,
              failure: {
                phase: "processing",
                code: "detached_sub_session_failed",
                message: error.message,
                retryable: false,
              },
            };
            throw error;
          }
        }
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
  const outcome = await beforeDispatch.handler(beforeContext);

  assert.equal(subSessionCalls.length, 1);
  assertWorkflowFailedWithoutSuccessfulResult({
    ctx: beforeContext,
    outcome,
    subSessionCalls,
    forbiddenNodes: ["节点B"],
  });
  assert.match(String(outcome?.failure?.message || ""), /节点A子agent失败/);
});

test("workflow hook stops all fan-out downstream nodes after their upstream node fails", async () => {
  const hookManager = createMockBotHookManager();
  const subSessionCalls = [];

  registerWorkflowAgentHooks({
    hookManager,
    config: {
      enabled: true,
      mode: "on",
      resolveModelMessages: () => [],
      capabilityModelInvoker: async () => ({
        output: {
          text: [
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
        },
      }),
      subSessionRunner: async (payload = {}) => {
        subSessionCalls.push(payload);
        const nodeName = String(payload?.metadata?.nodeName || "").trim();
        if (nodeName === "节点A") {
          const error = new Error("节点A失败");
          error.lifecycle = {
            executionId: payload.strategy.executionId,
            executionKind: "agent",
            state: "processing_failed",
            revision: 3,
            sequence: 3,
            failure: {
              phase: "processing",
              code: "detached_sub_session_failed",
              message: error.message,
              retryable: false,
            },
          };
          throw error;
        }
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
          result: { messages: [{ role: "assistant", content: `ok-${nodeName}` }] },
        };
      },
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  const ctx = {
    userId: "u1",
    sessionId: "s-failure-fanout",
    dialogProcessId: "d-failure-fanout",
    userMessage: "请运行失败传播流程",
    runConfig: { locale: "zh-CN" },
  };
  const outcome = await beforeDispatch.handler(ctx);
  assert.equal(subSessionCalls.length, 1);
  assertWorkflowFailedWithoutSuccessfulResult({
    ctx,
    outcome,
    subSessionCalls,
    forbiddenNodes: ["节点B", "节点C"],
  });
});

test("workflow hook does not execute a merge downstream node after an upstream branch fails", async () => {
  const hookManager = createMockBotHookManager();
  const subSessionCalls = [];

  registerWorkflowAgentHooks({
    hookManager,
    config: {
      enabled: true,
      mode: "on",
      parallelNodeExecution: true,
      maxParallelNodeAgents: WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_PARALLEL_NODE_AGENTS,
      resolveModelMessages: () => [],
      capabilityModelInvoker: async () => ({
        output: {
          text: [
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
        },
      }),
      subSessionRunner: async (payload = {}) => {
        subSessionCalls.push(payload);
        const nodeName = String(payload?.metadata?.nodeName || "").trim();
        if (nodeName === "节点A") {
          const error = new Error("节点A失败");
          error.lifecycle = {
            executionId: payload.strategy.executionId,
            executionKind: "agent",
            state: "processing_failed",
            revision: 3,
            sequence: 3,
            failure: {
              phase: "processing",
              code: "detached_sub_session_failed",
              message: error.message,
              retryable: false,
            },
          };
          throw error;
        }
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
          result: { messages: [{ role: "assistant", content: `ok-${nodeName}` }] },
        };
      },
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  const ctx = {
    userId: "u1",
    sessionId: "s-failure-merge",
    dialogProcessId: "d-failure-merge",
    userMessage: "请运行失败传播流程",
    runConfig: { locale: "zh-CN" },
  };
  const outcome = await beforeDispatch.handler(ctx);
  assertWorkflowFailedWithoutSuccessfulResult({
    ctx,
    outcome,
    subSessionCalls,
    forbiddenNodes: ["节点C"],
  });
});

test("workflow hook does not execute any post-merge fan-out node after an upstream branch fails", async () => {
  const hookManager = createMockBotHookManager();
  const subSessionCalls = [];

  registerWorkflowAgentHooks({
    hookManager,
    config: {
      enabled: true,
      mode: "on",
      parallelNodeExecution: true,
      maxParallelNodeAgents: WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_PARALLEL_NODE_AGENTS,
      resolveModelMessages: () => [],
      capabilityModelInvoker: async () => ({
        output: {
          text: [
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
        },
      }),
      subSessionRunner: async (payload = {}) => {
        subSessionCalls.push(payload);
        const nodeName = String(payload?.metadata?.nodeName || "").trim();
        if (nodeName === "节点A") {
          const error = new Error("节点A失败");
          error.lifecycle = {
            executionId: payload.strategy.executionId,
            executionKind: "agent",
            state: "processing_failed",
            revision: 3,
            sequence: 3,
            failure: {
              phase: "processing",
              code: "detached_sub_session_failed",
              message: error.message,
              retryable: false,
            },
          };
          throw error;
        }
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
          result: { messages: [{ role: "assistant", content: `ok-${nodeName}` }] },
        };
      },
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  const ctx = {
    userId: "u1",
    sessionId: "s-failure-multi",
    dialogProcessId: "d-failure-multi",
    userMessage: "请运行失败传播流程",
    runConfig: { locale: "zh-CN" },
  };
  const outcome = await beforeDispatch.handler(ctx);
  assertWorkflowFailedWithoutSuccessfulResult({
    ctx,
    outcome,
    subSessionCalls,
    forbiddenNodes: ["节点C", "节点D"],
  });
});

test("workflow hook commits FAILED for a node whose sub-session throws without a lifecycle", async () => {
  const hookManager = createMockBotHookManager();
  const workflowNodeStateRepository = createInMemoryWorkflowNodeStateRepository();
  const subSessionCalls = [];

  registerWorkflowAgentHooks({
    hookManager,
    workflowNodeStateRepository,
    config: {
      enabled: true,
      mode: "on",
      resolveModelMessages: () => [],
      capabilityModelInvoker: async () => ({
        output: {
          text: [
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
        },
      }),
      subSessionRunner: async (payload = {}) => {
        subSessionCalls.push(payload);
        const error = new Error("子会话启动失败");
        error.code = "SUB_SESSION_START_FAILED";
        throw error;
      },
    },
  });

  const ctx = {
    userId: "u1",
    sessionId: "s-failure-no-lifecycle",
    dialogProcessId: "d-failure-no-lifecycle",
    userMessage: "请运行失败传播流程",
    runConfig: { locale: "zh-CN" },
  };
  await getBeforeDispatch(hookManager).handler(ctx);

  assert.equal(subSessionCalls.length, 1);
  const runs = Array.from(workflowNodeStateRepository.exportState().values());
  assert.equal(runs.length, 1);
  const nodes = Array.from(runs[0].nodes.values());
  const nodeA = nodes.find((node) => node.nodeName === "节点A");
  const nodeB = nodes.find((node) => node.nodeName === "节点B");
  assert.equal(nodeA.status, "failed");
  assert.deepEqual(nodeA.failure, {
    source: "workflow_node_agent",
    code: "SUB_SESSION_START_FAILED",
    message: "子会话启动失败",
  });
  assert.equal(nodeB.status, "skipped");
});
