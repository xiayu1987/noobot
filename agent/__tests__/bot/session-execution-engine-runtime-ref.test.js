/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SessionExecutionEngine } from "../../src/bot/session/session-execution-engine.js";
import { createAgentDetachedSubSessionStrategy } from "../../src/bot/session/detached-subsession-strategy.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";

test("AgentRuntimeFacade.buildRunTurnContext keeps runtime object reference for tool/model switch consistency", () => {
  const engine = new SessionExecutionEngine({});
  const runtime = { runtimeModel: "" };
  const agentContext = createTestAgentExecutionScope(runtime);

  const abortSignal = { aborted: false };
  const out = engine.agentRuntimeFacade.buildRunTurnContext(agentContext, abortSignal);

  assert.equal(
    out.bindings.runtime,
    runtime,
    "runtime 引用应保持一致，避免工具侧与模型侧状态分叉",
  );
  assert.equal(runtime.abortSignal, abortSignal);

  runtime.runtimeModel = "gpt_5_3_codex";
  assert.equal(
    out.bindings.runtime.runtimeModel,
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

test("SessionExecutionEngine preserves persistence context and cross-layer scope", async () => {
  const engine = new SessionExecutionEngine({});
  const persistenceContext = { kind: "trusted-context" };
  const persistenceScope = { scopeId: "agent:child" };
  const turnAcceptance = Object.freeze({
    commandId: "command-1",
    sessionId: "s1",
    turnScopeId: "turn-1",
    dialogProcessId: "dialog-1",
    messageUid: "message-1",
    aggregateVersion: 1,
    committedEventPublished: true,
  });
  let captured = null;
  engine.runner = {
    async runSession(payload) {
      captured = payload;
      return { ok: true };
    },
  };

  await engine.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    persistenceContext,
    persistenceScope,
    turnAcceptance,
  });

  assert.equal(captured.persistenceContext, persistenceContext);
  assert.equal(captured.persistenceScope, persistenceScope);
  assert.equal(captured.turnAcceptance, turnAcceptance);
});

test("SessionExecutionEngine exposes the complete authority event repository port", async () => {
  const calls = [];
  const session = {
    async commitAuthorityEvent(payload) {
      calls.push(["commit", payload]);
      return { committed: true };
    },
    async getPendingAuthorityEvents(payload) {
      calls.push(["pending", payload]);
      return { found: true, events: [] };
    },
    async recordAuthorityEventAttempt(payload) {
      calls.push(["attempt", payload]);
      return { recorded: true };
    },
    async acknowledgeAuthorityEvent(payload) {
      calls.push(["acknowledge", payload]);
      return { acknowledged: true };
    },
    async compactAuthorityEvents(payload) {
      calls.push(["compact", payload]);
      return { compacted: true };
    },
  };
  const engine = new SessionExecutionEngine({ session });
  const payload = { sessionId: "session-1" };

  assert.deepEqual(await engine.commitAuthorityEvent(payload), { committed: true });
  assert.deepEqual(await engine.getPendingAuthorityEvents(payload), { found: true, events: [] });
  assert.deepEqual(await engine.recordAuthorityEventAttempt(payload), { recorded: true });
  assert.deepEqual(await engine.acknowledgeAuthorityEvent(payload), { acknowledged: true });
  assert.deepEqual(await engine.compactAuthorityEvents(payload), { compacted: true });
  assert.deepEqual(calls.map(([operation]) => operation), [
    "commit",
    "pending",
    "attempt",
    "acknowledge",
    "compact",
  ]);
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
        return {
          applied: true,
          envelope,
          turn: envelope,
          aggregateVersion: lifecycleSequence,
          dialogProcessId: payload.dialogProcessId,
          ...(payload.eventType === "turn.action_accepted"
            ? { userMessage: { messageUid: "detached-user-message" } }
            : {}),
        };
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
    parentExecutionScope: createTestAgentExecutionScope({ userInteractionBridge: bridge }),
    parentContext: {
      userId: "u1",
      sessionId: "parent-session",
      dialogProcessId: "parent-dialog",
      runConfig: {},
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
  assert.equal(capturedRunSessionPayload?.turnAcceptance?.messageUid, "detached-user-message");
});
