/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SessionExecutionEngine } from "../../src/bot/session/session-execution-engine.js";
import { createAgentDetachedSubSessionStrategy } from "../../src/bot/session/detached-subsession-strategy.js";

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

test("SessionExecutionEngine forwards the authoritative dialog identity to runtime initialization", async () => {
  const engine = new SessionExecutionEngine({});
  let captured = null;
  engine.initializer = {
    async initializeRunSessionRuntime(payload = {}) {
      captured = payload;
      return payload;
    },
  };

  await engine._initializeRunSessionRuntime({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "authoritative-dialog",
    turnScopeId: "turn-1",
  });

  assert.equal(captured.dialogProcessId, "authoritative-dialog");
});

test("detached sub-session runner inherits userInteractionBridge from parent runtime", async () => {
  const bridge = {
    async requestUserInteraction() {
      return { ok: true };
    },
  };
  let lifecycleSequence = 0;
  const engine = new SessionExecutionEngine({
    workspaceService: { getWorkspacePath: () => "/tmp" },
    configService: { async loadUserConfig() { return {}; } },
    session: {
      createScopedPersistenceContext() {
        return Object.freeze({ marker: "scoped" });
      },
      async applyTurnLifecycleEvent(payload = {}) {
        lifecycleSequence += 1;
        const envelope = { ...payload, revision: lifecycleSequence, sequence: lifecycleSequence };
        return { applied: true, envelope, turn: envelope };
      },
    },
  });
  let capturedRunSessionPayload = null;
  engine.runner = {
    async runSession(payload = {}) {
      capturedRunSessionPayload = payload;
      return { output: "done", dialogProcessId: payload.dialogProcessId };
    },
  };
  engine._prepareRunConfig = ({ runConfig = {} } = {}) => runConfig;

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
    strategy: createAgentDetachedSubSessionStrategy({
      userId: "u1",
      parentSessionId: "parent-session",
      parentDialogProcessId: "parent-dialog",
    }),
  });

  assert.equal(capturedRunSessionPayload?.userInteractionBridge, bridge);
  assert.match(capturedRunSessionPayload?.turnScopeId, /^internal-turn:/);
});
