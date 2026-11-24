/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { processingTurnChanges } from "../helpers/turn-command-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";

import { SESSION_ERROR_CODE, TURN_EVENT, TURN_PHASE } from "@noobot/session-protocol";
import { normalizeSessionEntity } from "../../src/session/entities/session-entity.js";
import { acceptTurn, canonical, harness } from "./session-version-hardening.test-helpers.js";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";
import { TEST_MESSAGE_TS } from "../helpers/session-run-payload.js";

async function completeTurn(service, turnScopeId) {
  const base = {
    userId: "u1",
    sessionId: "s1",
    turnScopeId,
    presentationMessageId: `presentation-${turnScopeId}`,
  };
  const steps = [
    [TURN_EVENT.PROCESSING_STARTED, { phase: TURN_PHASE.PROCESSING }],
    [
      TURN_EVENT.PROCESSING_COMPLETED,
      {
        phase: TURN_PHASE.COMPLETION,
        completionCommitId: `${turnScopeId}-${TURN_EVENT.COMPLETED}`,
      },
    ],
    [
      TURN_EVENT.COMPLETED,
      { phase: TURN_PHASE.COMPLETION, summaryVersion: 1, terminalStatus: { command: "completed" } },
    ],
  ];
  for (const [index, [eventType, extra]] of steps.entries()) {
    const commandId = `${turnScopeId}-${eventType}`;
    const result = await service.applyTurnLifecycleEvent({
      ...base,
      ...extra,
      eventType,
      commandId,
      causationId: commandId,
      expectedRevision: index + 1,
    });
    if (!result.applied) throw new Error(`completeTurn rejected: ${result.reason}`);
  }
}

test("accepted user message and bindTurnAttachments increment one aggregate version each", async () => {
  const h = await harness();
  const first = await acceptTurn(h.service, { turnScopeId: "t1", content: "one" });
  const bound = await h.service.bindTurnAttachments({
    userId: "u1",
    sessionId: "s1",
    turnScopeId: "t1",
    messageUid: first.userMessage.messageUid,
    commandId: "i1:attachments.bind",
    expectedAggregateVersion: 1,
    attachments: [canonical()],
  });
  await completeTurn(h.service, "t1");
  const second = await acceptTurn(h.service, { turnScopeId: "t2", content: "two" });
  assert.equal(first.aggregateVersion, 1);
  assert.equal(bound.aggregateVersion, 2);
  assert.equal(second.aggregateVersion, 3);
  assert.equal(h.get().aggregateVersion, 3);
  assert.deepEqual(bound.attachments, [canonical()]);
});

test("accepted user message persists the preallocated user message identity", async () => {
  const h = await harness();
  const result = await acceptTurn(h.service, { turnScopeId: "t1", userMessageId: "um_user-1" });
  assert.equal("id" in result.userMessage, false);
  assert.equal("messageId" in result.userMessage, false);
  assert.equal(result.userMessage.userMessageId, "um_user-1");
  assert.equal(h.get().messages[0].userMessageId, "um_user-1");
});

test("accepted user message persists internal run origin without frontend user identity", async () => {
  const h = await harness();
  const result = await acceptTurn(h.service, {
    turnScopeId: "internal-turn:1",
    userMessage: {
      content: "internal task",
      userMessageId: "um_internal-1",
      messageOrigin: "internal",
    },
  });
  assert.equal(result.userMessage.messageOrigin, "internal");
  assert.equal("userMetaMaterialized" in result.userMessage, false);
});

test("accepted turns receive allocated dialog identity and an immutable logical dialog ordinal", async () => {
  const h = await harness();
  let allocations = 0;
  h.service.allocateDialogProcessId = () => `d${++allocations}`;
  await acceptTurn(h.service, { turnScopeId: "t1", content: "first" });
  await completeTurn(h.service, "t1");
  await acceptTurn(h.service, { turnScopeId: "t2", content: "second" });

  assert.deepEqual(
    h.get().dialogOrder.map(({ dialogProcessId, dialogOrdinal }) => ({
      dialogProcessId,
      dialogOrdinal,
    })),
    [
      { dialogProcessId: "d1", dialogOrdinal: 1 },
      { dialogProcessId: "d2", dialogOrdinal: 2 },
    ],
  );
  assert.equal(
    h.get().dialogOrder.some((entry) => "sequence" in entry),
    false,
  );
  assert.equal(
    h
      .get()
      .messages.filter((message) => message.role === "user")
      .every((m) => /^sm_/.test(m.messageUid)),
    true,
  );
});

test("dialog order accepts only canonical dialogOrdinal and messageUid fields", () => {
  const normalized = normalizeSessionEntity(
    {
      ...createTestSessionRequiredFields(),
      sessionId: "s1",
      aggregateVersion: 0,
      messages: [
        {
          sessionId: "s1",
          role: "user",
          attachments: [],
          messageOrigin: "natural",
          content: "legacy",
          dialogProcessId: "d1",
          turnScopeId: "t1",
          messageUid: "sm_m1",
          userMessageId: "m1",
          ts: "2026-01-01T00:00:00.000Z",
        },
      ],
      dialogOrder: [{ dialogProcessId: "d1", dialogOrdinal: 7 }],
    },
    { now: () => "2026-01-01T00:00:00.000Z" },
  );

  assert.deepEqual(
    normalized.dialogOrder.map(({ userMessageUid, ...entry }) => entry),
    [
      {
        dialogProcessId: "d1",
        turnScopeId: "",
        dialogOrdinal: 7,
      },
    ],
  );
  assert.equal(normalized.dialogOrder[0].userMessageUid, "");
  assert.equal("userMessageId" in normalized.dialogOrder[0], false);
  assert.equal("sequence" in normalized.dialogOrder[0], false);
});

test("messages without a persistent messageUid are rejected", () => {
  const invalid = {
    ...createTestSessionRequiredFields(),
    sessionId: "s1",
    aggregateVersion: 0,
    dialogOrder: [
      {
        dialogProcessId: "d1",
        turnScopeId: "t1",
        userMessageUid: "",
        dialogOrdinal: 1,
      },
    ],
    messages: [
      {
        role: "assistant",
        attachments: [],
        presentationMessageId: "pm_fx1",
        content: "legacy",
        modelMessageId: "am_1",
        dialogProcessId: "d1",
        turnScopeId: "t1",
        ts: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
  assert.throws(
    () => normalizeSessionEntity(invalid),
    /invalid session message identity: session_message_uid_missing/,
  );
});

test("bindTurnAttachments binds the exact accepted user message and replays idempotently", async () => {
  const h = await harness();
  const accepted = await acceptTurn(h.service, { turnScopeId: "t1" });
  const input = {
    userId: "u1",
    sessionId: "s1",
    turnScopeId: "t1",
    messageUid: accepted.userMessage.messageUid,
    commandId: "i1:attachments.bind",
    expectedAggregateVersion: 1,
    attachments: [canonical()],
  };
  const bound = await h.service.bindTurnAttachments(input);
  const replay = await h.service.bindTurnAttachments(input);

  assert.equal(bound.aggregateVersion, 2);
  assert.equal(replay.aggregateVersion, 2);
  assert.equal(replay.deduplicated, true);
  assert.equal(replay.messageUid, accepted.userMessage.messageUid);
  assert.deepEqual(replay.attachments, [canonical()]);
  assert.deepEqual(h.get().messages[0].attachments, [canonical()]);
});

test("bindTurnAttachments enforces command, aggregate, message and single-binding identities", async (t) => {
  const createCommitted = async () => {
    const h = await harness();
    const committed = await acceptTurn(h.service, { turnScopeId: "t1" });
    return { h, committed };
  };

  await t.test("commandId conflict", async () => {
    const { h, committed } = await createCommitted();
    const base = {
      userId: "u1",
      sessionId: "s1",
      turnScopeId: "t1",
      messageUid: committed.userMessage.messageUid,
      commandId: "bind-1",
      expectedAggregateVersion: 1,
    };
    await h.service.bindTurnAttachments({ ...base, attachments: [canonical()] });
    await assert.rejects(
      h.service.bindTurnAttachments({ ...base, attachments: [canonical("a2")] }),
      (error) => error.code === "SESSION_IDEMPOTENCY_KEY_REUSED",
    );
  });

  await t.test("aggregate version conflict", async () => {
    const { h, committed } = await createCommitted();
    await assert.rejects(
      h.service.bindTurnAttachments({
        userId: "u1",
        sessionId: "s1",
        turnScopeId: "t1",
        messageUid: committed.userMessage.messageUid,
        commandId: "bind-1",
        expectedAggregateVersion: 0,
        attachments: [canonical()],
      }),
      (error) =>
        error.code === SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT &&
        error.statusCode === 409 &&
        Number.isSafeInteger(error.currentVersion),
    );
  });

  await t.test("message identity mismatch", async () => {
    const { h } = await createCommitted();
    await assert.rejects(
      h.service.bindTurnAttachments({
        userId: "u1",
        sessionId: "s1",
        turnScopeId: "other-turn",
        messageUid: "sm_missing",
        commandId: "bind-1",
        expectedAggregateVersion: 1,
        attachments: [canonical()],
      }),
      (error) => error.statusCode === 404,
    );
  });

  await t.test("second binding", async () => {
    const { h, committed } = await createCommitted();
    const base = {
      userId: "u1",
      sessionId: "s1",
      turnScopeId: "t1",
      messageUid: committed.userMessage.messageUid,
      expectedAggregateVersion: 1,
    };
    await h.service.bindTurnAttachments({
      ...base,
      commandId: "bind-1",
      attachments: [canonical()],
    });
    await assert.rejects(
      h.service.bindTurnAttachments({
        ...base,
        commandId: "bind-2",
        expectedAggregateVersion: 2,
        attachments: [canonical("a2")],
      }),
      (error) => error.code === "SESSION_TURN_ATTACHMENTS_ALREADY_BOUND",
    );
  });
});

test("internal append and summary checkpoint use mutation lock without changing public version", async () => {
  const h = await harness({
    aggregateVersion: 7,
    messages: [
      {
        messageUid: "sm_q",
        sessionId: "s1",
        ts: TEST_MESSAGE_TS,
        role: "user",
        attachments: [],
        messageOrigin: "natural",
        content: "q",
        turnScopeId: "t",
        dialogProcessId: "dp",
      },
      {
        messageUid: "sm_old",
        sessionId: "s1",
        ts: TEST_MESSAGE_TS,
        role: "user",
        attachments: [],
        messageOrigin: "natural",
        content: "historical",
        turnScopeId: "old",
        dialogProcessId: "dp-old",
      },
    ],
    fixtureChanges: processingTurnChanges({
      sessionId: "s1",
      dialogProcessId: "dp",
      turnScopeId: "t",
      presentationMessageId: "message-t",
    }),
  });
  await h.service.appendTurns({
    userId: "u1",
    sessionId: "s1",
    turns: [
      {
        messageUid: "sm_a",
        ts: TEST_MESSAGE_TS,
        role: "assistant",
        attachments: [],
        transferEnvelopes: [],
        presentationMessageId: "message-t",
        modelMessageId: "mm_session_version_hardenin_1",
        content: "a",
        turnScopeId: "t",
        dialogProcessId: "dp",
      },
    ],
  });
  const targetUid = "sm_a";
  await h.service.commitTurnSummaryCheckpoint({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp",
    turnScopeId: "t",
    checkpointId: "cp-lock",
    summarizedMessageUids: [targetUid],
    expectedCheckpointRevision: 0,
    persistedMessageUids: [],
    retainedMessageUids: [],
    messages: [],
  });
  assert.equal(h.get().aggregateVersion, 7);
  assert.equal(h.get().messages.find((m) => m.messageUid === targetUid).summarized, true);
  assert.equal(h.get().messages.find((m) => m.messageUid === "sm_q").summarized, false);
  assert.equal(h.get().messages.find((m) => m.dialogProcessId === "dp-old").summarized, false);
  assert.equal(h.locks(), 2);
});

test("summary checkpoint without complete transaction identity fails closed", async () => {
  const h = await harness({
    messages: [
      {
        messageUid: "sm_old",
        sessionId: "s1",
        attachments: [],
        turnScopeId: "old",
        ts: TEST_MESSAGE_TS,
        role: "user",
        messageOrigin: "natural",
        content: "historical",
        dialogProcessId: "dp-old",
      },
    ],
  });

  await assert.rejects(
    h.service.commitTurnSummaryCheckpoint({
      userId: "u1",
      sessionId: "s1",
      checkpointId: "cp-missing-scope",
      summarizedMessageUids: ["sm_old"],
      expectedCheckpointRevision: 0,
      persistedMessageUids: [],
      retainedMessageUids: [],
      messages: [],
    }),
    (error) => error.code === "DIALOG_PROCESS_ID_INVALID",
  );

  assert.equal(h.get().messages[0].summarized, false);
  assert.equal(h.locks(), 0);
});

test("turn summary checkpoints mark exact UIDs and persist an idempotent scoped receipt", async () => {
  const h = await harness({
    messages: [
      {
        messageUid: "sm_target",
        chatPresentation: false,
        sessionId: "s1",
        attachments: [],
        ts: TEST_MESSAGE_TS,
        role: "assistant",
        presentationMessageId: "message-t",
        modelMessageId: "mm_session_version_hardenin_2",
        content: "same",
        dialogProcessId: "dp",
        turnScopeId: "t",
      },
      {
        messageUid: "sm_keep",
        sessionId: "s1",
        attachments: [],
        ts: TEST_MESSAGE_TS,
        role: "assistant",
        presentationMessageId: "message-t",
        modelMessageId: "mm_session_version_hardenin_3",
        content: "same",
        dialogProcessId: "dp",
        turnScopeId: "t",
      },
      {
        messageUid: "sm_history",
        sessionId: "s1",
        attachments: [],
        ts: TEST_MESSAGE_TS,
        role: "assistant",
        presentationMessageId: "pm_fx5",
        modelMessageId: "mm_session_version_hardenin_4",
        content: "same",
        dialogProcessId: "old",
        turnScopeId: "old-t",
      },
    ],
    fixtureChanges: processingTurnChanges({
      sessionId: "s1",
      dialogProcessId: "dp",
      turnScopeId: "t",
      presentationMessageId: "message-t",
    }),
  });
  const input = {
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp",
    turnScopeId: "t",
    checkpointId: "cp-1",
    persistedMessageUids: ["sm_target", "sm_keep"],
    summarizedMessageUids: ["sm_target"],
    expectedCheckpointRevision: 0,
    retainedMessageUids: [],
    messages: [],
  };

  const committed = await h.service.commitTurnSummaryCheckpoint(input);
  const replay = await h.service.commitTurnSummaryCheckpoint(input);

  assert.equal(committed.committed, true);
  assert.equal(committed.checkpointRevision, 1);
  assert.equal(replay.deduplicated, true);
  assert.equal(replay.checkpointRevision, 1);
  assert.equal(h.get().messages.find((m) => m.messageUid === "sm_target").summarized, true);
  assert.equal(h.get().messages.find((m) => m.messageUid === "sm_keep").summarized, false);
  assert.equal(h.get().messages.find((m) => m.messageUid === "sm_history").summarized, false);
  assert.equal(h.get().turnSummaryCheckpoints.t.checkpointRevision, 1);
  assert.equal("sequence" in h.get().turnSummaryCheckpoints.t, false);
});

test("turn summary checkpoint restores explicitly retained messages to active context", async () => {
  const h = await harness({
    messages: [
      {
        messageUid: "sm_summary",
        chatPresentation: false,
        ts: TEST_MESSAGE_TS,
        sessionId: "s1",
        role: "assistant",
        attachments: [],
        presentationMessageId: "message-t",
        modelMessageId: "mm_session_version_hardenin_5",
        content: "old context",
        dialogProcessId: "dp",
        turnScopeId: "t",
      },
      {
        messageUid: "sm_retained",
        ts: TEST_MESSAGE_TS,
        sessionId: "s1",
        role: "assistant",
        attachments: [],
        presentationMessageId: "message-t",
        modelMessageId: "mm_session_version_hardenin_6",
        content: "latest check",
        dialogProcessId: "dp",
        turnScopeId: "t",
        summarized: true,
      },
    ],
    fixtureChanges: processingTurnChanges({
      sessionId: "s1",
      dialogProcessId: "dp",
      turnScopeId: "t",
      presentationMessageId: "message-t",
    }),
  });

  await h.service.commitTurnSummaryCheckpoint({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp",
    turnScopeId: "t",
    checkpointId: "cp-retained",
    persistedMessageUids: ["sm_summary", "sm_retained"],
    summarizedMessageUids: ["sm_summary"],
    retainedMessageUids: ["sm_retained"],
    messages: [],
    expectedCheckpointRevision: 0,
  });

  assert.equal(h.get().messages.find((m) => m.messageUid === "sm_summary").summarized, true);
  assert.equal(h.get().messages.find((m) => m.messageUid === "sm_retained").summarized, false);
  assert.deepEqual(h.get().turnSummaryCheckpoints.t.receipts[0].retainedMessageUids, [
    "sm_retained",
  ]);
  const reloaded = normalizeSessionEntity(structuredClone(h.get()));
  assert.deepEqual(reloaded.turnSummaryCheckpoints.t.receipts[0].retainedMessageUids, [
    "sm_retained",
  ]);
});

test("turn summary checkpoints reject a split assistant tool-call and result pair", async () => {
  const h = await harness({
    messages: [
      {
        messageUid: "sm_call",
        type: "tool_call",
        sessionId: "s1",
        attachments: [],
        ts: TEST_MESSAGE_TS,
        role: "assistant",
        presentationMessageId: "message-t",
        modelMessageId: "mm_session_version_hardenin_7",
        content: "",
        dialogProcessId: "dp",
        turnScopeId: "t",
        tool_calls: [{ id: "call_1", function: { name: "read_file", arguments: "{}" } }],
      },
      {
        messageUid: "sm_result",
        type: "tool_result",
        sessionId: "s1",
        attachments: [],
        ts: TEST_MESSAGE_TS,
        role: "tool",
        presentationMessageId: "message-t",
        content: "result",
        dialogProcessId: "dp",
        turnScopeId: "t",
        tool_call_id: "call_1",
      },
    ],
    fixtureChanges: processingTurnChanges({
      sessionId: "s1",
      dialogProcessId: "dp",
      turnScopeId: "t",
      presentationMessageId: "message-t",
    }),
  });

  await assert.rejects(
    h.service.commitTurnSummaryCheckpoint({
      userId: "u1",
      sessionId: "s1",
      dialogProcessId: "dp",
      turnScopeId: "t",
      checkpointId: "cp-split",
      persistedMessageUids: ["sm_call", "sm_result"],
      summarizedMessageUids: ["sm_result"],
      expectedCheckpointRevision: 0,
      retainedMessageUids: [],
      messages: [],
    }),
    (error) => error.code === "TURN_SUMMARY_CHECKPOINT_TOOL_PAIR_SPLIT",
  );

  assert.equal(
    h.get().messages.some((message) => message.summarized === true),
    false,
  );
});

test("turn summary checkpoints allow exact historical summary targets but keep persistence scoped", async () => {
  const crossTurn = await harness({
    messages: [
      {
        messageUid: "sm_current",
        sessionId: "s1",
        attachments: [],
        ts: TEST_MESSAGE_TS,
        role: "assistant",
        presentationMessageId: "message-t",
        modelMessageId: "mm_session_version_hardenin_8",
        content: "current",
        dialogProcessId: "dp",
        turnScopeId: "t",
      },
      {
        messageUid: "sm_old",
        sessionId: "s1",
        attachments: [],
        ts: TEST_MESSAGE_TS,
        role: "assistant",
        presentationMessageId: "pm_fx11",
        modelMessageId: "mm_session_version_hardenin_9",
        content: "old",
        dialogProcessId: "old",
        turnScopeId: "old-t",
      },
    ],
    fixtureChanges: processingTurnChanges({
      sessionId: "s1",
      dialogProcessId: "dp",
      turnScopeId: "t",
      presentationMessageId: "message-t",
    }),
  });
  const historical = await crossTurn.service.commitTurnSummaryCheckpoint({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp",
    turnScopeId: "t",
    checkpointId: "cp-cross",
    summarizedMessageUids: ["sm_old"],
    expectedCheckpointRevision: 0,
    persistedMessageUids: [],
    retainedMessageUids: [],
    messages: [],
  });
  assert.equal(historical.committed, true);
  assert.equal(
    crossTurn.get().messages.find((message) => message.messageUid === "sm_old").summarized,
    true,
  );
  assert.deepEqual(crossTurn.get().turnSummaryCheckpoints.t.receipts[0].summarizedMessageUids, [
    "sm_old",
  ]);
  const replay = await crossTurn.service.commitTurnSummaryCheckpoint({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp",
    turnScopeId: "t",
    checkpointId: "cp-cross",
    summarizedMessageUids: ["sm_old"],
    expectedCheckpointRevision: 0,
    persistedMessageUids: [],
    retainedMessageUids: [],
    messages: [],
  });
  assert.equal(replay.deduplicated, true);

  await assert.rejects(
    crossTurn.service.commitTurnSummaryCheckpoint({
      userId: "u1",
      sessionId: "s1",
      dialogProcessId: "dp",
      turnScopeId: "t",
      checkpointId: "cp-cross-persist",
      persistedMessageUids: ["sm_old"],
      expectedCheckpointRevision: 1,
      summarizedMessageUids: [],
      retainedMessageUids: [],
      messages: [],
    }),
    (error) => error.code === "TURN_SUMMARY_CHECKPOINT_MESSAGE_SCOPE_CONFLICT",
  );
});
