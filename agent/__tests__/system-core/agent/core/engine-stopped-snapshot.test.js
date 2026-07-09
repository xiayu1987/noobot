/*
 * Copyright (c) 2026 xiayu
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runAgentTurn } from "../../../../src/system-core/agent/core/engine.js";
import { loadStoppedModelMessageSnapshot } from "../../../../src/system-core/agent/core/resume/model-message-snapshot-store.js";

function createAbortedSignal() {
  const controller = new AbortController();
  controller.abort({ type: "user_stop", reason: "user stop action" });
  return controller.signal;
}

test("runAgentTurn persists user stopped model message snapshot from engine user stop catch", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-engine-stop-snapshot-"));
  const events = [];
  const runtime = {
    userId: "admin",
    sessionId: "session-engine-stop",
    globalConfig: {
      workspaceRoot,
      defaultModelAlias: "test_model",
      providers: {
        test_model: {
          enabled: true,
          type: "openai_compatible",
          model: "test-model",
          api_key: "test-key",
          baseUrl: "http://localhost/test",
        },
      },
    },
    userConfig: {},
    runConfig: { turnScopeId: "turn-engine-stop" },
    abortSignal: createAbortedSignal(),
    eventListener: {
      onEvent(event) {
        events.push(event);
      },
    },
    systemRuntime: {
      userId: "admin",
      sessionId: "session-engine-stop",
      parentSessionId: "parent-session-engine-stop",
      dialogProcessId: "dialog-engine-stop",
      turnScopeId: "turn-engine-stop",
      toolLoopExecutionCount: 0,
      phaseSummaryLoopCount: 0,
      toolConsecutiveFailureCount: 0,
    },
  };
  const agentContext = {
    payload: {
      messages: {
        system: [],
        history: [],
      },
      tools: { registry: [] },
    },
    execution: {
      controllers: { runtime },
    },
    environment: {
      identity: { userId: "admin" },
    },
    session: {
      current: { id: "session-engine-stop" },
      parent: { id: "parent-session-engine-stop" },
    },
  };

  await assert.rejects(
    () => runAgentTurn({ agentContext, userMessage: "stop after snapshot candidate" }),
    (error) => error?.name === "AbortError",
  );

  const snapshot = await loadStoppedModelMessageSnapshot({
    globalConfig: runtime.globalConfig,
    identity: {
      userId: "admin",
      sessionId: "session-engine-stop",
      dialogProcessId: "dialog-engine-stop",
      turnScopeId: "turn-engine-stop",
    },
  });

  assert.equal(snapshot.userId, "admin");
  assert.equal(snapshot.sessionId, "session-engine-stop");
  assert.equal(snapshot.parentSessionId, "parent-session-engine-stop");
  assert.equal(snapshot.dialogProcessId, "dialog-engine-stop");
  assert.equal(snapshot.turnScopeId, "turn-engine-stop");
  assert.ok(snapshot.messages.some((message) => String(message.content || "").includes("stop after snapshot candidate")));
  assert.ok(snapshot.messageBlocks.incremental.some((message) => String(message.content || "").includes("stop after snapshot candidate")));

  const savedEvent = events.find((event) => event?.event === "stopped_model_message_snapshot_saved");
  assert.equal(savedEvent?.data?.source, "engine_user_stop_catch");
  assert.deepEqual(savedEvent?.data?.identity, {
    userId: "admin",
    sessionId: "session-engine-stop",
    parentSessionId: "parent-session-engine-stop",
    dialogProcessId: "dialog-engine-stop",
    turnScopeId: "turn-engine-stop",
  });
});
