/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_TURN_RESULT_ERROR_CODE,
  assertAgentTurnResult,
  createAgentTurnResult,
} from "../src/agent-turn-result.js";

function turnResult(turnMessages) {
  return {
    output: "",
    traces: [],
    turnMessages,
    turnTasks: [],
    modelLoopRound: 0,
    modelMessages: [],
  };
}

test("agent turn result accepts turn messages with messageUid", () => {
  const result = createAgentTurnResult(turnResult([{ role: "assistant", messageUid: "mu-1" }]));
  assert.equal(result.turnMessages[0].messageUid, "mu-1");
});

test("agent turn result rejects turn messages without messageUid", () => {
  for (const message of [{ role: "assistant" }, { role: "assistant", messageUid: " " }, null]) {
    assert.throws(
      () => assertAgentTurnResult(turnResult([message])),
      (error) =>
        error.code === AGENT_TURN_RESULT_ERROR_CODE && /invalid turnMessages/.test(error.message),
    );
  }
});
