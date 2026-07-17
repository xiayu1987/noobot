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

test("workflow hook aborts node sub-session when parent stop signal fires", async () => {
  const hookManager = createMockBotHookManager();
  const registerWorkflowHooks = createRegisterWorkflowHooks();
  const abortController = new AbortController();
  let receivedAbortSignal = null;

  registerWorkflowHooks({
    hookManager,
    options: {
      enabled: true,
      mode: "on",
      semanticModel: "semantic-model",
      semanticPrompt: "emit workflow dsl",
      capabilityModelInvoker: async () => ({
        output: [
          "WORKFLOW_DSL/1",
          'NODE id=start type=state stateType=start name="开始"',
          'NODE id=act type=action name="节点A" task="执行当前请求"',
          'NODE id=end type=state stateType=end name="结束"',
          'EDGE from=start to=act',
          'EDGE from=act to=end',
          "END",
        ].join("\n"),
      }),
      subSessionRunner: async ({ abortSignal } = {}) => {
        receivedAbortSignal = abortSignal;
        setTimeout(() => {
          abortController.abort({ type: "user_stop", reason: "test stop" });
        }, 0);
        await new Promise((resolve, reject) => {
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
      generatedArtifactPersister: async () => [],
      workflowDialogPersister: async () => null,
      workflowEventLogger: async () => null,
    },
  });

  const beforeDispatch = getBeforeDispatch(hookManager);
  await assert.rejects(
    () =>
      beforeDispatch.handler({
        userId: "u1",
        sessionId: "s1",
        dialogProcessId: "d1",
        userMessage: "请执行一个工作流",
        runConfig: { locale: "zh-CN" },
        abortSignal: abortController.signal,
      }),
    (error) => {
      assert.equal(error?.name, "AbortError");
      return true;
    },
  );
  assert.equal(receivedAbortSignal, abortController.signal);
});

