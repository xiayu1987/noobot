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

import { appendTurnContextControlMessage } from "../../../src/runtime/turn/turn-context-message-appender.js";
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
  CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_PROMPT,
  CONTEXT_INJECTED_MESSAGE_TYPE.HELP_TOOL_LOOP_PROMPT,
]) {
  test(`context control message ${internalType} is marked injected in turn and model context`, () => {
    const { runtime } = createTurnScope();
    const persisted = appendTurnContextControlMessage({
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

test("context control message rejects non-control internal types", () => {
  const { runtime } = createTurnScope();
  assert.throws(
    () =>
      appendTurnContextControlMessage({
        runtime,
        content: "user words",
        internalType: CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION,
      }),
    TypeError,
  );
  assert.equal(runtime.currentTurnMessages.toArray().length, 0);
});
