/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { reconcileCompletedTurnOrphanToolCalls } from "../src/index.js";
import { SESSION_REPAIR_ERROR_CODE } from "../src/errors.js";

function orphanToolCallSession({ status = "completed", answeredIds = [] } = {}) {
  const scope = { dialogProcessId: "dialog-1", turnScopeId: "turn-1" };
  return {
    turnLifecycle: {
      ...createEmptyTurnLifecycle(),
      turns: { "turn-1": { ...scope, terminalStatus: { status, reason: "run_completed" } } },
    },
    messages: [
      { ...scope, messageUid: "user-1", role: "user", type: "message" },
      {
        ...scope,
        messageUid: "rejected-1",
        role: "assistant",
        type: "tool_call",
        tool_calls: [
          { id: "call-1", function: { name: "task_check" } },
          { id: "call-2", function: { name: "execute_script" } },
        ],
      },
      ...answeredIds.map((id) => ({
        ...scope,
        messageUid: `result-${id}`,
        role: "tool",
        type: "tool_result",
        tool_call_id: id,
      })),
      { ...scope, messageUid: "final-1", role: "assistant", type: "message" },
    ],
  };
}

test("orphan tool_call repair drops completed Turn tool_calls without any tool result", () => {
  const result = reconcileCompletedTurnOrphanToolCalls(orphanToolCallSession());
  assert.equal(result.changed, true);
  assert.deepEqual(result.removed, ["rejected-1"]);
  assert.deepEqual(
    result.document.messages.map((message) => message.messageUid),
    ["user-1", "final-1"],
  );
});

test("orphan tool_call repair keeps fully answered tool_calls and unfinished Turns", () => {
  const answered = orphanToolCallSession({ answeredIds: ["call-1", "call-2"] });
  assert.equal(reconcileCompletedTurnOrphanToolCalls(answered).changed, false);
  const running = orphanToolCallSession({ status: "failed" });
  assert.equal(reconcileCompletedTurnOrphanToolCalls(running).changed, false);
});

test("orphan tool_call repair rejects partially answered tool_calls", () => {
  assert.throws(
    () => reconcileCompletedTurnOrphanToolCalls(orphanToolCallSession({ answeredIds: ["call-1"] })),
    { code: SESSION_REPAIR_ERROR_CODE.ORPHAN_TOOL_CALL_REPAIR_AMBIGUOUS },
  );
});

test("orphan tool_call repair rejects non-object messages as an invalid repair source", () => {
  const source = orphanToolCallSession();
  source.messages.push("not-a-message");
  assert.throws(() => reconcileCompletedTurnOrphanToolCalls(source), {
    code: SESSION_REPAIR_ERROR_CODE.REPAIR_SOURCE_INVALID,
  });
});
