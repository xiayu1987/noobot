/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";
import test from "node:test";
import assert from "node:assert/strict";
import { runAgentTurn } from "../../../src/runtime/engine.js";
import { createHookManager } from "@noobot/hook-protocol";

function createAbortedSignal() {
  const controller = new AbortController();
  controller.abort({ type: "user_stop", reason: "user stop action" });
  return controller.signal;
}

test("runAgentTurn completes terminal hooks before the runner seals a stopped snapshot", async () => {
  const events = [];
  const abortHookContexts = [];
  const errorHookContexts = [];
  const hookManager = createHookManager();
  hookManager.on("agent.on_abort", (context) => abortHookContexts.push(context));
  hookManager.on("agent.on_error", (context) => errorHookContexts.push(context));
  const runtime = {
    userId: "admin",
    sessionId: "session-engine-stop",
    globalConfig: {
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
    hookManager,
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
  const agentContext = createTestAgentExecutionScope(runtime);

  await assert.rejects(
    () => runAgentTurn({
      agentContext,
      currentUserMessage: {
        messageUid: "sm_engine_stop",
        role: "user",
        content: "stop after snapshot candidate",
        dialogProcessId: "dialog-engine-stop",
        turnScopeId: "turn-engine-stop",
      },
    }),
    (error) => error?.name === "AbortError",
  );

  assert.equal(events.some((event) => event?.event === "stopped_model_message_snapshot_saved"), false);
  assert.ok(runtime.stoppedModelMessageSnapshotCandidate.messageBlocks.incremental.some(
    (message) => String(message.content || "").includes("stop after snapshot candidate"),
  ));
  assert.equal(abortHookContexts.length, 1);
  assert.equal(errorHookContexts.length, 1);
  assert.equal(abortHookContexts[0].contextProtocolVersion, 1);
  assert.equal(errorHookContexts[0].contextProtocolVersion, 1);
  assert.equal(abortHookContexts[0].modelContext, runtime.activeMessageContext);
  assert.equal(errorHookContexts[0].modelContext, runtime.activeMessageContext);
});
