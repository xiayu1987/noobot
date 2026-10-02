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

import { appendTurnContextControlMessage } from "../../../src/runtime/turn/turn-context-message-appender.js";
import { createCurrentTurnMessagesStore } from "../../../src/runtime/turn/current-turn-ledger.js";

function createTurnScope() {
  const runtime = { currentTurnMessages: createCurrentTurnMessagesStore() };
  const loopState = {
    dialogProcessId: "dlg_control",
    modelContext: createModelContext({
      messages: [],
      activeTurnIdentity: { dialogProcessId: "dlg_control", turnScopeId: "turn_control" },
    }),
  };
  return { runtime, loopState };
}

for (const internalType of [
  CONTEXT_INJECTED_MESSAGE_TYPE.TASK_CHECK_PROMPT,
  CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_PROMPT,
  CONTEXT_INJECTED_MESSAGE_TYPE.HELP_TOOL_LOOP_PROMPT,
]) {
  test(`context control message ${internalType} is marked injected in turn and model context`, () => {
    const { runtime, loopState } = createTurnScope();
    const persisted = appendTurnContextControlMessage({
      runtime,
      loopState,
      content: "control prompt",
      internalType,
    });
    assert.equal(isInjectedMessage(persisted), true);
    assert.equal(persisted.injectedMessageType, internalType);
    const modelMessage = loopState.modelContext.messageBlocks.incremental.at(-1);
    assert.equal(isInjectedMessage(modelMessage), true);
    assert.equal(modelMessage.additional_kwargs.injectedMessageType, internalType);
  });
}

test("context control message rejects non-control internal types", () => {
  const { runtime, loopState } = createTurnScope();
  assert.throws(
    () =>
      appendTurnContextControlMessage({
        runtime,
        loopState,
        content: "user words",
        internalType: CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION,
      }),
    TypeError,
  );
  assert.equal(runtime.currentTurnMessages.toArray().length, 0);
});
