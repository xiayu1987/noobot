/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelContext } from "@noobot/context-protocol";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/message/injected-types";
import { isInjectedMessage } from "@noobot/context-protocol/policy/message";
import { isInjectedSessionMessageRecord } from "@noobot/session-protocol";

import {
  appendTurnRuntimeInjectedMessage,
  appendUserInterjectionMessage,
} from "../../../src/runtime/turn/turn-context-message-appender.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";

function createTurnScope() {
  const runtime = createTestRuntimeContext();
  runtime.activeMessageContext = createModelContext({
    messageBlocks: { system: [], history: [], incremental: [] },
    activeTurnIdentity: { dialogProcessId: "dlg_control", turnScopeId: "turn_control" },
  });
  return { runtime };
}

for (const internalType of [
  CONTEXT_INJECTED_MESSAGE_TYPE.TASK_CHECK_PROMPT,
  CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_RESULT,
  CONTEXT_INJECTED_MESSAGE_TYPE.HELP_TOOL_LOOP_PROMPT,
]) {
  test(`runtime injected message ${internalType} is marked injected in turn and model context`, () => {
    const { runtime } = createTurnScope();
    const persisted = appendTurnRuntimeInjectedMessage({
      runtime,
      content: "control prompt",
      internalType,
    });
    assert.equal(isInjectedSessionMessageRecord(persisted), true);
    assert.equal(persisted.injectedMessageType, internalType);
    const modelMessage = runtime.activeMessageContext.messageBlocks.incremental.at(-1);
    assert.equal(isInjectedMessage(modelMessage), true);
    assert.equal(modelMessage.additional_kwargs.injectedMessageType, internalType);
  });
}

test("runtime injection rejects the separately accepted user interjection category", () => {
  const { runtime } = createTurnScope();
  assert.throws(
    () =>
      appendTurnRuntimeInjectedMessage({
        runtime,
        content: "user words",
        internalType: CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION,
      }),
    TypeError,
  );
  assert.equal(runtime.currentTurnMessages.toArray().length, 0);
});

test("interjection admission and duplicate lookup never expand the current turn", () => {
  const { runtime } = createTurnScope();
  for (let index = 0; index < 1024; index += 1)
    runtime.currentTurnMessages.push({ messageUid: `prefix-${index}`, role: "tool" });
  runtime.currentTurnMessages.acknowledgeChanges(
    runtime.currentTurnMessages.readPendingChanges().entries,
  );
  runtime.currentTurnMessages.toArray = () => {
    throw new Error("full turn read");
  };
  const interjection = {
    messageUid: "interjection",
    message: "continue here",
    interjectionSequence: 1,
    receivedAt: "2026-11-14T00:00:00.000Z",
  };
  const first = appendUserInterjectionMessage({ runtime, interjection });
  const pending = runtime.currentTurnMessages.readPendingChanges();
  assert.deepEqual(appendUserInterjectionMessage({ runtime, interjection }), first);
  assert.deepEqual(runtime.currentTurnMessages.readPendingChanges(), pending);
  assert.equal(pending.entries.length, 1);
  assert.equal(runtime.activeMessageContext.messageBlocks.incremental.length, 1);
});
