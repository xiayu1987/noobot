/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createModelContext } from "@noobot/context-protocol";
import { writeContextMessageMetadata } from "@noobot/context-protocol/message/codec";
import { createTurnOrchestrator } from "../../../src/runtime/turn/orchestrator.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";

test("an interjection accepted during the final model call is consumed before completion", async () => {
  const modelContext = createModelContext({
    messageBlocks: { system: [], history: [], incremental: [] },
    activeTurnIdentity: { dialogProcessId: "dialog-1", turnScopeId: "scope-1" },
  });
  const pendingInterjections = [
    { commandId: "command-1", messageUid: "interjection-uid-command-1", message: "first" },
    { commandId: "command-2", messageUid: "interjection-uid-command-2", message: "second" },
  ];
  const observedModelInputs = [];
  let invocation = 0;
  let consumeCount = 0;
  let queueSealed = false;
  const runtime = createTestRuntimeContext({
    identity: { sessionId: "session-1", turnScopeId: "scope-1" },
    systemRuntime: {},
    sealUserInterjectionQueueIfEmpty() {
      if (pendingInterjections.length) return false;
      queueSealed = true;
      return true;
    },
    async consumeUserInterjections() {
      consumeCount += 1;
      const batch = pendingInterjections.splice(0);
      for (const interjection of batch) {
        currentTurnMessages.push({
          messageUid: interjection.messageUid,
          role: "user",
          content: interjection.message,
          injectedMessage: true,
          injectedMessageType: "noobot.user_interjection",
        });
        modelContext.messages.push(
          writeContextMessageMetadata(
            { role: "user", content: interjection.message },
            {
              messageUid: interjection.messageUid,
              injectedMessage: true,
              injectedMessageType: "noobot.user_interjection",
            },
          ),
        );
      }
      return batch;
    },
  });
  runtime.activeMessageContext = modelContext;
  const { currentTurnMessages } = runtime;
  const run = createTurnOrchestrator({
    resolveLlmForTurnFn: () => {},
    assertNotAbortedFn: () => {},
    invokeWithToolsTurnFn: async () => {
      invocation += 1;
      observedModelInputs.push(modelContext.messages.map((message) => message.content));
      return {
        aiContentText:
          invocation === 1 ? "answer before interjection" : "answer after interjection",
        modelMessageId: `assistant-${invocation}`,
        calls: [],
        turnMessageStore: currentTurnMessages,
      };
    },
    buildLoopResultFn: ({ output }) => ({ output }),
    maybeRequestPhaseSummaryFn: () => {},
    maybeRequestTaskCheckFn: () => {},
    maybePromptHelpToolByLoopFn: () => {},
    maybePromptHelpToolByFailureFn: () => {},
  });

  const result = await run({
    modelState: { runtime, agentContext: createTestAgentExecutionScope(runtime) },
    loopState: {
      tools: [{}],
      traces: [],
      maxTurns: 10,
      turnMessages: [],
    },
  });

  assert.equal(result.output, "answer after interjection");
  assert.equal(invocation, 2);
  assert.equal(consumeCount, 1);
  assert.equal(queueSealed, true);
  assert.deepEqual(observedModelInputs[1], ["first", "second"]);
  assert.deepEqual(
    currentTurnMessages
      .toArray()
      .filter((message) => message.injectedMessageType === "noobot.user_interjection")
      .map((message) => message.content),
    ["first", "second"],
  );
});
