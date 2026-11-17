/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelContext } from "@noobot/context-protocol";
import { writeContextMessageMetadata } from "@noobot/context-protocol/message/codec";
import { createMessageUid } from "@noobot/session-protocol/message-identity";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import {
  maybeRequestPhaseSummary,
  maybeRequestTaskCheck,
  maybePromptHelpToolByLoop,
  maybePromptHelpToolByFailure,
} from "../../../src/runtime/loop-control.js";
import {
  claimMainFlowSummaryScheduling,
  peekMainFlowPhaseSummary,
} from "../../../src/runtime/main-flow-control.js";
import { tEngine } from "../../../src/runtime/i18n-adapter.js";

function fixture({ messages = [], systemRuntime = {} } = {}) {
  const runtime = createTestRuntimeContext({ systemRuntime });
  runtime.activeMessageContext = createModelContext({
    messageBlocks: { system: [], history: [], incremental: messages },
  });
  runtime.activeMessageContext.activeTurnIdentity = {
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
  };
  return { runtime };
}

test("phase summary schedules once at the turn threshold without tools or prompt injection", async () => {
  const message = writeContextMessageMetadata(
    { role: "system", content: "work evidence" },
    {
      messageUid: createMessageUid(),
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
    },
  );
  const modelState = fixture({ messages: [message] });
  const loopState = { phaseSummaryLoopTurns: 2, tools: [] };
  assert.equal(await maybeRequestPhaseSummary({ modelState, loopState }), false);
  assert.equal(await maybeRequestPhaseSummary({ modelState, loopState }), true);
  const instruction = peekMainFlowPhaseSummary(modelState.runtime);
  assert.equal(instruction.source, "agent.phase_summary");
  assert.equal(instruction.prompt, tEngine(modelState.runtime, "phaseSummaryPrompt"));
  assert.equal(await maybeRequestPhaseSummary({ modelState, loopState }), false);
  assert.equal(peekMainFlowPhaseSummary(modelState.runtime), instruction);
  assert.deepEqual(modelState.runtime.activeMessageContext.messages, [message]);
  assert.equal(modelState.runtime.systemRuntime.phaseSummaryLoopCount, 2);
  instruction.onCommitted();
  assert.equal(modelState.runtime.systemRuntime.phaseSummaryLoopCount, 0);
});

test("disabled or unreached turn-only thresholds do not scan the model context", async () => {
  const modelState = { runtime: createTestRuntimeContext({ systemRuntime: {} }) };
  for (const loopState of [
    {},
    { phaseSummaryLoopTurns: 0, phaseSummaryMessageCharsThreshold: 0 },
    { phaseSummaryLoopTurns: 20, phaseSummaryMessageCharsThreshold: 0 },
  ]) {
    assert.equal(await maybeRequestPhaseSummary({ modelState, loopState }), false);
    assert.equal(peekMainFlowPhaseSummary(modelState.runtime), null);
  }
});

test("phase summary schedules at the character threshold", async () => {
  const message = writeContextMessageMetadata(
    { role: "system", content: "0123456789012345" },
    {
      messageUid: createMessageUid(),
      summarized: false,
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
    },
  );
  const modelState = fixture({ messages: [message] });
  assert.equal(
    await maybeRequestPhaseSummary({
      modelState,
      loopState: {
        phaseSummaryLoopTurns: 0,
        phaseSummaryMessageCharsThreshold: 10,
      },
    }),
    true,
  );
  assert.equal(modelState.runtime.activeMessageContext.messages.length, 1);
});

test("retained large context does not repeatedly trigger summary for small new evidence", async () => {
  const record = (messageUid, role, content, metadata = {}) =>
    writeContextMessageMetadata(
      { role, content },
      { messageUid, dialogProcessId: "dialog-1", turnScopeId: "turn-1", ...metadata },
    );
  const modelState = fixture({
    messages: [
      record("user", "user", "u".repeat(100)),
      record("summary", "user", "s".repeat(100), {
        injectedMessage: true,
        injectedMessageType: "noobot.phase_summary_result",
      }),
      record("work", "system", "short"),
    ],
  });
  modelState.runtime.activeMessageContext.messageBlocks.system.push(
    record("system", "system", "p".repeat(100)),
  );
  const loopState = { phaseSummaryLoopTurns: 0, phaseSummaryMessageCharsThreshold: 10 };
  for (let turn = 0; turn < 3; turn++) {
    assert.equal(await maybeRequestPhaseSummary({ modelState, loopState }), false);
  }
  assert.equal(peekMainFlowPhaseSummary(modelState.runtime), null);
  modelState.runtime.activeMessageContext.messageBlocks.incremental.push(
    record("more-work", "system", "0123456789"),
  );
  assert.equal(await maybeRequestPhaseSummary({ modelState, loopState }), true);
});

test("summary thresholds do not schedule without compressible messages", async () => {
  for (const messages of [
    [],
    [
      writeContextMessageMetadata(
        { role: "user", content: "0123456789" },
        {
          messageUid: createMessageUid(),
          dialogProcessId: "dialog-1",
          turnScopeId: "turn-1",
        },
      ),
    ],
  ]) {
    const modelState = fixture({ messages });
    assert.equal(
      await maybeRequestPhaseSummary({
        modelState,
        loopState: {
          phaseSummaryLoopTurns: 1,
          phaseSummaryMessageCharsThreshold: 1,
        },
      }),
      false,
    );
    assert.equal(peekMainFlowPhaseSummary(modelState.runtime), null);
  }
});

test("external summary scheduling prevents duplicate main flow scheduling", async () => {
  const modelState = fixture();
  claimMainFlowSummaryScheduling(modelState.runtime, { source: "plugin.summary" });
  assert.equal(
    await maybeRequestPhaseSummary({ modelState, loopState: { phaseSummaryLoopTurns: 1 } }),
    false,
  );
  assert.equal(peekMainFlowPhaseSummary(modelState.runtime), null);
});

test("summary scheduling notification rejection propagates and preserves the pending instruction", async () => {
  const message = writeContextMessageMetadata(
    { role: "system", content: "work evidence" },
    {
      messageUid: createMessageUid(),
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
    },
  );
  const modelState = fixture({ messages: [message] });
  const failure = new Error("summary scheduling notification failed");
  let notificationCount = 0;
  modelState.runtime.eventListener = {
    async onEvent({ event }) {
      assert.equal(event, "phase_summary_required");
      notificationCount += 1;
      throw failure;
    },
  };
  const loopState = { phaseSummaryLoopTurns: 1 };
  await assert.rejects(
    maybeRequestPhaseSummary({ modelState, loopState }),
    (error) => error === failure,
  );
  const instruction = peekMainFlowPhaseSummary(modelState.runtime);
  assert.equal(instruction.source, "agent.phase_summary");
  assert.equal(modelState.runtime.systemRuntime.phaseSummaryLoopCount, 1);
  assert.equal(await maybeRequestPhaseSummary({ modelState, loopState }), false);
  assert.equal(peekMainFlowPhaseSummary(modelState.runtime), instruction);
  assert.equal(notificationCount, 1);
});

test("task checks are periodic and accepted checks reset their counter", () => {
  const modelState = fixture();
  const loopState = { tools: [{ name: "task_check" }], taskCheckLoopTurns: 2 };
  assert.equal(maybeRequestTaskCheck({ modelState, loopState }), false);
  assert.equal(maybeRequestTaskCheck({ modelState, loopState }), true);
  const message = modelState.runtime.currentTurnMessages.toArray()[0];
  assert.equal(message.noobotInternalMessageType, "noobot.task_check_prompt");
  assert.equal(message.chatPresentation, false);
  assert.equal(maybeRequestTaskCheck({ modelState, loopState }), false);
  assert.equal(
    maybeRequestTaskCheck({
      modelState,
      loopState,
      toolCallResults: [{ call: { name: "task_check" }, success: true }],
    }),
    false,
  );
  assert.equal(modelState.runtime.systemRuntime.taskCheckLoopCount, 0);
  assert.equal(modelState.runtime.currentTurnMessages.toArray().length, 1);
});

test("loop and failure help prompts use canonical message stores and reset counters", () => {
  const modelState = fixture({
    systemRuntime: { helpPromptLoopCount: 1, toolConsecutiveFailureCount: 3 },
  });
  const loopState = { tools: [{ name: "help" }], helpPromptLoopTurns: 2, toolFailureHelpCount: 3 };
  assert.equal(maybePromptHelpToolByLoop({ modelState, loopState }), true);
  assert.equal(maybePromptHelpToolByFailure({ modelState, loopState }), true);
  assert.equal(modelState.runtime.systemRuntime.helpPromptLoopCount, 0);
  assert.equal(modelState.runtime.systemRuntime.toolConsecutiveFailureCount, 0);
  assert.equal(modelState.runtime.currentTurnMessages.toArray().length, 2);
  assert.equal(modelState.runtime.activeMessageContext.messageBlocks.incremental.length, 2);
  assert.deepEqual(modelState.runtime.activeMessageContext.messageBlocks.system, []);
});
