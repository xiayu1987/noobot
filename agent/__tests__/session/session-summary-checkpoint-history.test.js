/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { turnRecord } from "../helpers/turn-record.js";
import { harness } from "./session-version-hardening.test-helpers.js";
import { TEST_MESSAGE_TS } from "../helpers/session-run-payload.js";

test("turn summary checkpoints validate historical tool pairs inside their original round", async () => {
  const h = await harness({
    messages: [
      {
        messageUid: "sm_old_call",
        type: "tool_call",
        sessionId: "s1",
        attachments: [],
        ts: TEST_MESSAGE_TS,
        role: "assistant",
        presentationMessageId: "message-old-t",
        modelMessageId: "mm_session_version_hardenin_10",
        content: "",
        dialogProcessId: "old",
        turnScopeId: "old-t",
        tool_calls: [{ id: "call_1", function: { name: "read_file", arguments: "{}" } }],
      },
      {
        messageUid: "sm_old_result",
        type: "tool_result",
        sessionId: "s1",
        attachments: [],
        ts: TEST_MESSAGE_TS,
        role: "tool",
        presentationMessageId: "message-old-t",
        content: "result",
        dialogProcessId: "old",
        turnScopeId: "old-t",
        tool_call_id: "call_1",
      },
    ],
    turnLifecycle: {
      ...createEmptyTurnLifecycle(),
      sequence: 1,
      activeTurnScopeId: "t",
      turns: {
        t: turnRecord({
          revision: 1,
          sequence: 1,
          turnScopeId: "t",
          dialogProcessId: "dp",
          state: "processing",
        }),
      },
    },
  });

  await assert.rejects(
    h.service.commitTurnSummaryCheckpoint({
      userId: "u1",
      sessionId: "s1",
      dialogProcessId: "dp",
      turnScopeId: "t",
      checkpointId: "cp-old-split",
      summarizedMessageUids: ["sm_old_result"],
      expectedCheckpointRevision: 0,
      persistedMessageUids: [],
      retainedMessageUids: [],
      messages: [],
    }),
    (error) => error.code === "TURN_SUMMARY_CHECKPOINT_TOOL_PAIR_SPLIT",
  );
});

test("terminal turn checkpoints only mark already persisted canonical messages", async () => {
  const terminal = await harness({
    messages: [
      {
        messageUid: "sm_done",
        sessionId: "s1",
        attachments: [],
        ts: TEST_MESSAGE_TS,
        role: "assistant",
        presentationMessageId: "message-t",
        modelMessageId: "mm_session_version_hardenin_11",
        content: "done",
        dialogProcessId: "dp",
        turnScopeId: "t",
      },
    ],
    turnLifecycle: {
      ...createEmptyTurnLifecycle(),
      sequence: 1,
      activeTurnScopeId: "",
      turns: {
        t: turnRecord({
          revision: 1,
          sequence: 1,
          turnScopeId: "t",
          dialogProcessId: "dp",
          state: "completed",
        }),
      },
    },
  });
  const committed = await terminal.service.commitTurnSummaryCheckpoint({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp",
    turnScopeId: "t",
    checkpointId: "cp-terminal",
    summarizedMessageUids: ["sm_done"],
    expectedCheckpointRevision: 0,
    persistedMessageUids: [],
    retainedMessageUids: [],
    messages: [],
  });
  assert.equal(committed.committed, true);
  assert.equal(terminal.get().messages[0].summarized, true);

  await assert.rejects(
    terminal.service.commitTurnSummaryCheckpoint({
      userId: "u1",
      sessionId: "s1",
      dialogProcessId: "dp",
      turnScopeId: "t",
      checkpointId: "cp-terminal-persist",
      persistedMessageUids: ["sm_done"],
      summarizedMessageUids: ["sm_done"],
      expectedCheckpointRevision: 1,
      retainedMessageUids: [],
      messages: [],
    }),
    (error) => error.code === "TURN_SUMMARY_CHECKPOINT_TERMINAL_PERSISTENCE",
  );
});
