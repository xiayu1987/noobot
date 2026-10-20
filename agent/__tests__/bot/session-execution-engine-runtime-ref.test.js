/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createTestSessionExecutionEngine } from "../helpers/session-execution-engine.js";
import { createAgentDetachedSubSessionStrategy } from "../../src/bot/session/detached-subsession-strategy.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";
import { createTestRuntimeContext } from "../helpers/test-runtime-context.js";
import { DETACHED_REQUEST_METADATA } from "./detached-subsession-runner.test-helpers.js";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";
import { createTestSessionRunPayload } from "../helpers/session-run-payload.js";

test("SessionExecutionEngine forwards the authoritative dialog identity to runtime initialization", async () => {
  const engine = createTestSessionExecutionEngine({});
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

test("SessionExecutionEngine forwards only the cross-layer persistence scope", async () => {
  const engine = createTestSessionExecutionEngine({});
  const persistenceScope = { scopeId: "agent:child" };
  const userInterjectionPort = {
    consume: async () => [],
    sealIfEmpty: () => true,
  };
  const turnAcceptance = Object.freeze({
    ...createTestSessionRequiredFields(),
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

  await engine.runSession(
    createTestSessionRunPayload({
      userId: "u1",
      sessionId: "s1",
      parentSessionId: "",
      message: "hello",
      turnScopeId: "turn-1",
      persistenceScope,
      turnAcceptance,
      userInterjectionPort,
    }),
  );

  assert.equal(Object.hasOwn(captured, "persistenceContext"), false);
  assert.equal(captured.parentSessionId, "");
  assert.equal(captured.persistenceScope, persistenceScope);
  assert.equal(captured.turnAcceptance, turnAcceptance);
  assert.equal(captured.userInterjectionPort, userInterjectionPort);
});
test("detached sub-session runner inherits userInteractionBridge from parent runtime", async () => {
  const bridge = {
    async requestUserInteraction() {
      return { ok: true };
    },
  };
  let lifecycleSequence = 0;
  const engine = createTestSessionExecutionEngine({
    workspaceService: { getWorkspacePath: () => "/tmp" },
    configService: {
      async loadUserConfig() {
        return {};
      },
    },
    session: {
      async appendExecutionLog() {},
      async writeSessionMetadata() {},
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
    abortSignal: new AbortController().signal,
    parentExecutionScope: createTestAgentExecutionScope(
      createTestRuntimeContext({ userInteractionBridge: bridge }),
    ),
    message: "node task",
    metadata: DETACHED_REQUEST_METADATA,
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

test("SessionExecutionEngine rejects incomplete dependencies at construction", () => {
  assert.throws(
    () => createTestSessionExecutionEngine({ pluginRuntimeBundle: undefined }),
    /SessionExecutionEngine requires: pluginRuntimeBundle/,
  );
  assert.throws(
    () => createTestSessionExecutionEngine({ agentRunner: {} }),
    /agentRunner must be a function/,
  );
  assert.throws(
    () => createTestSessionExecutionEngine({ pluginRuntimeBundle: {} }),
    /pluginRuntimeBundle requires loadedPlugins,pluginRuntime/,
  );
});
