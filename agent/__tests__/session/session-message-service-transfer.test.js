/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TRANSFER_VERSION } from "@noobot/semantic-transfer-protocol";
import test from "node:test";
import assert from "node:assert/strict";

import { sessionMutationFixture, mutationMessage } from "../helpers/session-mutation-fixture.js";

test("SessionMessageService.appendTurns persists transferEnvelopes", async (t) => {
  const f = await sessionMutationFixture(t);
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: TRANSFER_VERSION,
    transferId: "transfer:message-att-1:tool:call-att-1:output:tool_result_text:structured",
    presentationMessageId: "message-att-1",
    identity: {
      sessionId: "s1",
      turnScopeId: "turn-att-1",
      runId: "run-att-1",
      producer: { type: "plugin", id: "harness-plugin" },
    },
    direction: "output",
    payload: {
      mode: "attachment",
      attachments: [
        {
          identity: { attachmentId: "att_1", sessionId: "s1", attachmentSource: "model" },
          role: "primary",
          name: "a.md",
          mimeType: "text/markdown",
        },
      ],
    },
    intent: {
      source: "plugin",
      reason: "semantic_transfer_tool_result",
      scenario: "tool",
      strategy: "tool_result_text",
    },
    meta: { persisted: true },
  };
  await f.service.appendTurns({
    ...f.request,
    turns: [
      {
        attachments: [],
        messageUid: "sm_done",
        role: "assistant",
        presentationMessageId: "pm_fx1",
        modelMessageId: "mm_session_message_service__1",
        content: "done",
        turnScopeId: "turn-att-1",
        dialogProcessId: "dialog-att-1",
        transferEnvelopes: [envelope],
      },
    ],
  });

  const lastMessage = (await (await f.open()).readMessageEntry({ messageUid: "sm_done" })).message;
  assert.equal("attachmentMetas" in lastMessage, false);
  assert.equal("transferEnvelopes" in lastMessage, true);
  assert.deepEqual(lastMessage?.transferEnvelopes, [envelope]);
  assert.equal(
    lastMessage.transferEnvelopes[0].payload.attachments[0].identity.attachmentId,
    "att_1",
  );
});

test("SessionMessageService.appendTurns leaves turnTimings to the timing fact writer", async (t) => {
  const f = await sessionMutationFixture(t);

  await f.service.appendTurns({
    ...f.request,
    turns: [
      {
        attachments: [],
        transferEnvelopes: [],
        messageUid: "sm_done",
        role: "assistant",
        presentationMessageId: "pm_fx2",
        modelMessageId: "mm_session_message_service__2",
        content: "done",
        turnScopeId: "turn-1",
        dialogProcessId: "dp-1",
      },
    ],
  });

  const reader = await f.open();
  const { message } = await reader.readMessageEntry({ messageUid: "sm_done" });
  assert.equal(Object.hasOwn(message, "thinkingStartedAt"), false);
  assert.equal(Object.hasOwn(message, "thinkingFinishedAt"), false);
  assert.equal(await reader.readTurnTiming("turn-1"), null);
});

test("SessionMessageService.upsertTurnTiming is first-write-wins and rejects conflicting facts", async (t) => {
  const f = await sessionMutationFixture(t, {
    messages: [mutationMessage("user-1", "turn-1", { dialogProcessId: "dp-1" })],
  });

  const timing = {
    ...f.request,
    turnScopeId: "turn-1",
    dialogProcessId: "dp-1",
    thinkingFinishedAt: "2026-07-08T16:30:44.744Z",
    modelLoopRound: 4,
  };

  const before = await f.open();
  assert.equal((await f.service.upsertTurnTiming(timing)).upserted, true);
  assert.equal((await f.service.upsertTurnTiming(timing)).reason, "unchanged");
  await assert.rejects(
    f.service.upsertTurnTiming({ ...timing, thinkingFinishedAt: "2026-07-08T16:31:00.000Z" }),
    { code: "SESSION_TURN_TIMING_CONFLICT" },
  );
  const reader = await f.open();
  assert.equal(reader.generation, before.generation + 1);
  assert.deepEqual(await reader.readTurnTiming("turn-1"), {
    turnScopeId: "turn-1",
    dialogProcessId: "dp-1",
    thinkingFinishedAt: "2026-07-08T16:30:44.744Z",
    modelLoopRound: 4,
  });
});

test("SessionMessageService.deleteFromMessage prunes orphan turnTimings", async (t) => {
  const f = await sessionMutationFixture(t, {
    aggregateVersion: 1,
    messages: [mutationMessage("keep"), mutationMessage("delete")],
  });
  const keepTiming = {
    turnScopeId: "keep",
    dialogProcessId: "dialog-keep",
    thinkingFinishedAt: "2026-07-08T00:00:01.000Z",
  };
  await f.commit({
    timings: [
      keepTiming,
      {
        turnScopeId: "delete",
        dialogProcessId: "dialog-delete",
        thinkingFinishedAt: "2026-07-08T00:00:00.500Z",
      },
    ],
  });
  await f.service.deleteFromMessage({
    ...f.request,
    anchor: { turnScopeId: "delete" },
    commandId: "delete-turn-timing",
  });
  const reader = await f.open();
  assert.deepEqual(await reader.readTurnTiming("keep"), keepTiming);
  assert.equal(await reader.readTurnTiming("delete"), null);
});

test("SessionMessageService.replaceTurn prunes replaced turnTimings", async (t) => {
  const f = await sessionMutationFixture(t, {
    aggregateVersion: 1,
    messages: [mutationMessage("keep"), mutationMessage("old")],
  });
  const keepTiming = { turnScopeId: "keep", dialogProcessId: "dialog-keep", modelLoopRound: 1 };
  await f.commit({
    timings: [keepTiming, { turnScopeId: "old", dialogProcessId: "dialog-old", modelLoopRound: 1 }],
  });
  await f.service.replaceTurn({
    ...f.request,
    attachments: [],
    anchor: { turnScopeId: "old" },
    newContent: "new",
    turnScopeId: "turn-new",
    commandId: "replace-turn-timing",
  });
  const reader = await f.open();
  assert.deepEqual(await reader.readTurnTiming("keep"), keepTiming);
  assert.equal(await reader.readTurnTiming("old"), null);
});
