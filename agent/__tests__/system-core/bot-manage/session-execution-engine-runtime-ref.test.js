/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SessionExecutionEngine } from "../../../src/system-core/bot-manage/session/session-execution-engine.js";

test("AgentRuntimeFacade.buildRunTurnContext keeps runtime object reference for tool/model switch consistency", () => {
  const engine = new SessionExecutionEngine({});
  const runtime = { runtimeModel: "" };
  const agentContext = {
    execution: {
      controllers: {
        runtime,
      },
    },
    payload: {
      tools: {
        registry: [],
      },
    },
  };

  const abortSignal = { aborted: false };
  const out = engine.agentRuntimeFacade.buildRunTurnContext(agentContext, abortSignal);

  assert.equal(
    out.execution.controllers.runtime,
    runtime,
    "runtime 引用应保持一致，避免工具侧与模型侧状态分叉",
  );
  assert.equal(runtime.abortSignal, abortSignal);

  runtime.runtimeModel = "gpt_5_3_codex";
  assert.equal(
    out.execution.controllers.runtime.runtimeModel,
    "gpt_5_3_codex",
    "同一引用下，工具修改 runtimeModel 后模型侧可见",
  );
});

test("detached sub-session runner inherits userInteractionBridge from parent runtime", async () => {
  const bridge = {
    async requestUserInteraction() {
      return { ok: true };
    },
  };
  const engine = new SessionExecutionEngine({
    workspaceService: { getWorkspacePath: () => "/tmp" },
    configService: { async loadUserConfig() { return {}; } },
  });

  let capturedBuildContextPayload = null;
  engine._prepareRunConfig = ({ runConfig = {} } = {}) => runConfig;
  engine._prepareAgentTurnExecution = async ({ buildContextPayload = {} } = {}) => {
    capturedBuildContextPayload = buildContextPayload;
    return {
      runtimeAgentContext: {
        payload: { runtime: { systemRuntime: { dialogProcessId: "sub-dialog" } } },
      },
    };
  };
  engine.agentRuntimeFacade = {
    async runTurn() {
      return {
        output: "done",
        dialogProcessId: "sub-dialog",
        turnMessages: [{ role: "assistant", content: "done" }],
      };
    },
  };

  const runner = engine._createDetachedSubSessionRunner();
  await runner({
    parentContext: {
      userId: "u1",
      sessionId: "parent-session",
      dialogProcessId: "parent-dialog",
      runConfig: {},
      agentContext: {
        execution: {
          controllers: {
            runtime: {
              userInteractionBridge: bridge,
            },
          },
        },
      },
    },
    message: "node task",
  });

  assert.equal(capturedBuildContextPayload?.userInteractionBridge, bridge);
});
