/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createMockBotHookManager,
  installTurnMessageEventRuntimeFixture,
  getBeforeDispatch,
  registerWorkflowAgentHooks,
} from "../helpers/workflow-hook-session-strategy-helper.js";

test("workflow hook aborts node sub-session when parent stop signal fires", async () => {
  const hookManager = createMockBotHookManager();
  const abortController = new AbortController();
  let receivedAbortSignal = null;

  registerWorkflowAgentHooks({
    hookManager,
    config: {
      enabled: true,
      mode: "on",
      semanticModel: "semantic-model",
      semanticPrompt: "emit workflow dsl",
      resolveModelMessages: () => [],
      capabilityModelInvoker: async () => ({
        output: {
          text: [
            "WORKFLOW_DSL/1",
            'NODE id=start type=state stateType=start name="开始"',
            'NODE id=act type=action name="节点A" task="执行当前请求"',
            'NODE id=end type=state stateType=end name="结束"',
            "EDGE from=start to=act",
            "EDGE from=act to=end",
            "END",
          ].join("\n"),
        },
      }),
      subSessionRunner: async ({ abortSignal } = {}) => {
        receivedAbortSignal = abortSignal;
        setTimeout(() => {
          abortController.abort({ type: "user_stop", reason: "test stop" });
        }, 0);
        await new Promise((_resolve, reject) => {
          if (abortSignal?.aborted) {
            const error = new Error("aborted before node");
            error.name = "AbortError";
            reject(error);
            return;
          }
          abortSignal?.addEventListener(
            "abort",
            () => {
              const error = new Error("aborted node");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        });
      },
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  await assert.rejects(
    () =>
      beforeDispatch.handler(
        installTurnMessageEventRuntimeFixture({
          userId: "u1",
          sessionId: "s1",
          dialogProcessId: "d1",
          userMessage: "请执行一个工作流",
          userMessageAttachments: [],
          runConfig: { locale: "zh-CN" },
        }),
        { signal: abortController.signal },
      ),
    (error) => {
      assert.equal(error?.name, "AbortError");
      return true;
    },
  );
  assert.equal(receivedAbortSignal, abortController.signal);
});

test("workflow waits for every parallel node sub-session to stop before planner rejects", async () => {
  const hookManager = createMockBotHookManager();
  const abortController = new AbortController();
  const settledNodes = [];
  let startedNodes = 0;

  registerWorkflowAgentHooks({
    hookManager,
    config: {
      enabled: true,
      mode: "on",
      semanticModel: "semantic-model",
      semanticPrompt: "emit parallel workflow dsl",
      parallelNodeExecution: true,
      maxParallelNodeAgents: 2,
      resolveModelMessages: () => [],
      capabilityModelInvoker: async () => ({
        output: {
          text: [
            "WORKFLOW_DSL/1",
            'NODE id=start type=state stateType=start name="开始"',
            'NODE id=branch type=state stateType=branch name="并发分叉"',
            'NODE id=a type=action name="节点A" task="执行A"',
            'NODE id=b type=action name="节点B" task="执行B"',
            'NODE id=merge type=state stateType=merge name="汇聚"',
            'NODE id=end type=state stateType=end name="结束"',
            "EDGE from=start to=branch",
            "EDGE from=branch to=a",
            "EDGE from=branch to=b",
            "EDGE from=a to=merge",
            "EDGE from=b to=merge",
            "EDGE from=merge to=end",
            "END",
          ].join("\n"),
        },
      }),
      subSessionRunner: async ({ abortSignal, metadata } = {}) => {
        startedNodes += 1;
        if (startedNodes === 2) {
          queueMicrotask(() => abortController.abort({ type: "user_stop", reason: "test stop" }));
        }
        await new Promise((resolve) =>
          abortSignal?.addEventListener("abort", resolve, { once: true }),
        );
        const nodeName = String(metadata?.nodeName || "");
        await new Promise((resolve) => setTimeout(resolve, nodeName === "节点A" ? 10 : 30));
        settledNodes.push(nodeName);
        const error = new Error(`aborted ${nodeName}`);
        error.name = "AbortError";
        throw error;
      },
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  const context = installTurnMessageEventRuntimeFixture({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    userMessage: "请并行执行工作流",
    userMessageAttachments: [],
    runConfig: { locale: "zh-CN" },
  });
  await assert.rejects(
    () => beforeDispatch.handler(context, { signal: abortController.signal }),
    (error) => error?.name === "AbortError",
  );

  assert.equal(startedNodes, 2);
  assert.deepEqual(new Set(settledNodes), new Set(["节点A", "节点B"]));
});
