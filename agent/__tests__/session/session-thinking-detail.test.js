/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { countCanonicalThinkingDetailEvents } from "@noobot/event-protocol/tool-timeline";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { createTurnArtifactRevision } from "@noobot/session-protocol/turn-lookup-key";
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  buildThinkingDetailPayload,
  readSessionThinkingDetail,
} from "../../src/session/session-thinking-detail.js";
import {
  SESSION_ARTIFACT_PREDECESSOR,
  readSessionTurn,
  writeSessionArtifact,
} from "../../src/session/session-artifact-store.js";
import { canonicalActivity } from "./session-repository-boundary.summaries.fixtures.js";
import {
  applySessionMessageFacts,
  createTestSessionRequiredFields,
} from "../helpers/session-message-facts.js";
import { TEST_MESSAGE_TS } from "../helpers/session-run-payload.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { buildPersistedDisplaySummary } from "./session-artifact-store-v2.test-helpers.js";

const TEST_TURN_ID = "turn-000001";
const TEST_COMMITTED_BYTES = 128;

function committedTurn({ sessionId, turnScopeId, dialogProcessId, messages }) {
  return {
    sessionId,
    turnId: TEST_TURN_ID,
    artifactOrdinal: 1,
    committedBytes: TEST_COMMITTED_BYTES,
    turnScopeId,
    dialogProcessId,
    messages: messages.map((message) => ({ sessionId, turnScopeId, dialogProcessId, ...message })),
    summarySnapshots: [],
  };
}

test("thinking detail message carries its Turn identity without duplicating scoped messages", () => {
  const payload = buildThinkingDetailPayload(
    committedTurn({
      sessionId: "session-detail",
      turnScopeId: "turn-detail",
      dialogProcessId: "dialog-detail",
      messages: [
        {
          messageUid: "final-assistant-source",
          ts: TEST_MESSAGE_TS,
          role: "assistant",
          presentationMessageId: "pm_turn_detail",
          modelMessageId: "mm_session_thinking_detail__1",
          type: "message",
          toolTimeline: [{ key: "call:one" }],
        },
        {
          messageUid: "guidance-source",
          ts: TEST_MESSAGE_TS,
          role: "assistant",
          presentationMessageId: "pm_turn_detail",
          modelMessageId: "mm_session_thinking_detail__2",
          type: "message",
          injectedMessage: true,
          content: "guidance",
        },
      ],
    }),
  );

  assert.equal(payload.exists, true);
  assert.equal(payload.sessionId, "session-detail");
  assert.deepEqual(
    {
      sessionId: payload.messageItem.sessionId,
      turnScopeId: payload.messageItem.turnScopeId,
      dialogProcessId: payload.messageItem.dialogProcessId,
      presentationMessageId: payload.messageItem.presentationMessageId,
    },
    {
      sessionId: "session-detail",
      turnScopeId: "turn-detail",
      dialogProcessId: "dialog-detail",
      presentationMessageId: "pm_turn_detail",
    },
  );
  assert.equal(Object.hasOwn(payload, "allMessages"), false);
  assert.equal(payload.counts.injectedMessageCount, 1);
  assert.deepEqual(payload.messageItem.thinkingContentTimeline, [
    {
      contentId: "message:guidance-source",
      contentKind: "injected_message",
      sourceMessageUid: "guidance-source",
      text: "guidance",
      timestamp: TEST_MESSAGE_TS,
      sequence: 2,
      sessionId: "session-detail",
      dialogProcessId: "dialog-detail",
      turnScopeId: "turn-detail",
      presentationMessageId: "pm_turn_detail",
    },
  ]);
  assert.equal(payload.counts.thinkingContentCount, 1);
});

test("thinking detail projects only activity facts, not assistant tool-call content, and excludes control injections", () => {
  const payload = buildThinkingDetailPayload(
    committedTurn({
      sessionId: "content-session",
      turnScopeId: "content-turn",
      dialogProcessId: "content-dialog",
      messages: [
        {
          messageUid: "assistant-tool-source",
          ts: TEST_MESSAGE_TS,
          modelMessageId: "presentation-content",
          role: "assistant",
          type: "tool_call",
          presentationMessageId: "presentation-content",
          content: "先确认当前真实状态。",
          toolTimeline: [{ key: "call:one" }],
          activityTimeline: [
            canonicalActivity({
              eventId: "model-content-event",
              activityKind: "model_analysis",
              sessionId: "content-session",
              dialogProcessId: "content-dialog",
              turnScopeId: "content-turn",
              presentationMessageId: "presentation-content",
            }),
          ],
        },
        {
          messageUid: "control-source",
          ts: TEST_MESSAGE_TS,
          role: "user",
          type: "context_control",
          injectedMessage: true,
          noobotInternalMessageType: "noobot.task_check_prompt",
          content: "hidden control prompt",
        },
        {
          messageUid: "final-source",
          ts: TEST_MESSAGE_TS,
          role: "assistant",
          presentationMessageId: "presentation-content",
          modelMessageId: "mm_session_thinking_detail__3",
          type: "message",
          content: "done",
        },
      ],
    }),
  );

  assert.deepEqual(
    payload.messageItem.thinkingContentTimeline.map((item) => [item.contentKind, item.text]),
    [["thinking", "analysis"]],
  );
  assert.equal(payload.counts.injectedMessageCount, 0);
  assert.equal(payload.counts.thinkingContentCount, 1);
});

test("thinking detail projects the complete Turn timeline onto the Turn presentation", () => {
  const payload = buildThinkingDetailPayload(
    committedTurn({
      sessionId: "child-session",
      turnScopeId: "workflow-node:turn-1",
      dialogProcessId: "dialog-workflow-node",
      messages: [
        {
          messageUid: "sm-tool-call-message",
          ts: TEST_MESSAGE_TS,
          role: "assistant",
          presentationMessageId: "final-assistant",
          modelMessageId: "mm_session_thinking_detail__4",
          type: "tool_call",
          toolTimeline: [{ key: "call:one", status: "running", call: { eventId: "call-start" } }],
        },
        {
          messageUid: "sm-tool-result-message",
          ts: TEST_MESSAGE_TS,
          role: "tool",
          presentationMessageId: "final-assistant",
          type: "tool_result",
          toolTimeline: [
            { key: "call:one", status: "completed", resultEvent: { eventId: "call-end" } },
          ],
        },
        {
          messageUid: "sm-final-assistant",
          ts: TEST_MESSAGE_TS,
          role: "assistant",
          presentationMessageId: "final-assistant",
          modelMessageId: "mm_session_thinking_detail__5",
          type: "message",
          content: "done",
          activityTimeline: [
            canonicalActivity({
              eventId: "analysis-1",
              sessionId: "child-session",
              dialogProcessId: "dialog-workflow-node",
              turnScopeId: "workflow-node:turn-1",
              presentationMessageId: "final-assistant",
            }),
          ],
        },
      ],
    }),
  );

  assert.equal(payload.messageItem.presentationMessageId, "final-assistant");
  assert.equal(payload.messageItem.toolTimeline.length, 1);
  assert.equal(payload.messageItem.toolTimeline[0].status, "completed");
  assert.equal(payload.messageItem.toolTimeline[0].call.eventId, "call-start");
  assert.equal(payload.messageItem.toolTimeline[0].resultEvent.eventId, "call-end");
  assert.equal(payload.messageItem.activityTimeline.length, 1);
  assert.equal(payload.messageItem.hasThinkingDetails, true);
  assert.equal(payload.counts.executionLogCount, 2);
});

test("thinking detail revision is the committed Turn journal position", () => {
  const turn = committedTurn({
    sessionId: "revision-session",
    turnScopeId: "revision-turn",
    dialogProcessId: "revision-dialog",
    messages: [
      {
        role: "assistant",
        presentationMessageId: "pm_fx7",
        modelMessageId: "mm_session_thinking_detail__6",
        type: "message",
      },
    ],
  });

  const payload = buildThinkingDetailPayload(turn);

  assert.equal(payload.revision, createTurnArtifactRevision(turn));
  assert.equal(payload.revision, `turn-journal:${TEST_TURN_ID}:${TEST_COMMITTED_BYTES}`);
});

test("thinking detail of an uncommitted Turn does not exist", () => {
  assert.deepEqual(buildThinkingDetailPayload(null), { exists: false });
});

test("thinking detail rejects a Turn whose records carry conflicting presentation identities", () => {
  assert.throws(
    () =>
      buildThinkingDetailPayload(
        committedTurn({
          sessionId: "conflict-session",
          turnScopeId: "conflict-turn",
          dialogProcessId: "conflict-dialog",
          messages: [
            { role: "assistant", presentationMessageId: "pm_one", type: "message" },
            { role: "assistant", presentationMessageId: "pm_two", type: "message" },
          ],
        }),
      ),
    { code: SESSION_ERROR_CODE.TURN_IDENTITY_CONFLICT },
  );
});

test("stopped Turn detail uses the persisted presentation identity without a final answer", () => {
  const payload = buildThinkingDetailPayload(
    committedTurn({
      sessionId: "stopped-session",
      turnScopeId: "stopped-turn",
      dialogProcessId: "stopped-dialog",
      messages: [
        {
          messageUid: "sm-tool-call-message",
          ts: TEST_MESSAGE_TS,
          role: "assistant",
          modelMessageId: "mm_session_thinking_detail__7",
          type: "tool_call",
          chatPresentation: false,
          presentationMessageId: "stopped-presentation",
          toolTimeline: [
            {
              key: "call:one",
              toolCallId: "one",
              call: { eventId: "call-one" },
              resultEvent: { eventId: "result-one" },
            },
          ],
        },
      ],
    }),
  );

  assert.equal(payload.exists, true);
  assert.equal(payload.messageItem.presentationMessageId, "stopped-presentation");
  assert.equal(payload.messageItem.turnScopeId, "stopped-turn");
  assert.equal(payload.messageItem.dialogProcessId, "stopped-dialog");
  assert.equal(Object.hasOwn(payload.messageItem, "role"), false);
  assert.equal(Object.hasOwn(payload.messageItem, "thinkingDetailCount"), false);
  assert.equal(countCanonicalThinkingDetailEvents(payload.messageItem), 2);
  assert.equal(payload.counts.executionLogCount, 2);
});

test("session summary references canonical thinking detail without copying its timeline", async () => {
  const messages = [
    {
      modelMessageId: "tool-call-one",
      role: "assistant",
      presentationMessageId: "final-assistant",
      type: "tool_call",
      content: "",
      turnScopeId: "workflow-node:turn-2",
      dialogProcessId: "dialog-workflow-node",
      toolTimeline: [
        {
          key: "call:one",
          toolCallId: "one",
          status: "completed",
          call: { eventId: "call-one" },
          resultEvent: { eventId: "result-one" },
        },
      ],
    },
    {
      modelMessageId: "tool-call-two",
      role: "assistant",
      presentationMessageId: "final-assistant",
      type: "tool_call",
      content: "",
      turnScopeId: "workflow-node:turn-2",
      dialogProcessId: "dialog-workflow-node",
      toolTimeline: [
        {
          key: "call:two",
          toolCallId: "two",
          status: "completed",
          call: { eventId: "call-two" },
          resultEvent: { eventId: "result-two" },
        },
      ],
    },
    {
      modelMessageId: "final-assistant",
      presentationMessageId: "final-assistant",
      role: "assistant",
      type: "message",
      turnScopeId: "workflow-node:turn-2",
      dialogProcessId: "dialog-workflow-node",
      content: "done",
    },
  ];

  const summary = await buildPersistedDisplaySummary({
    sessionId: "child-session",
    aggregateVersion: 0,
    messages,
  });
  const summaryMessage = summary.messages.find(
    (item) => item.presentationMessageId === "final-assistant",
  );
  const detail = buildThinkingDetailPayload(
    committedTurn({
      sessionId: "child-session",
      turnScopeId: "workflow-node:turn-2",
      dialogProcessId: "dialog-workflow-node",
      messages,
    }),
  );

  assert.equal(Object.hasOwn(summaryMessage, "thinkingDetailCount"), false);
  assert.equal(countCanonicalThinkingDetailEvents(summaryMessage), 4);
  assert.equal(summaryMessage.hasThinkingDetails, true);
  assert.equal(summaryMessage.toolTimeline.length, 2);
  assert.equal(summaryMessage.activityTimeline, undefined);
  assert.equal(
    countCanonicalThinkingDetailEvents(detail.messageItem),
    countCanonicalThinkingDetailEvents(summaryMessage),
  );
  assert.equal(detail.messageItem.toolTimeline.length, 2);
});

test("session summary does not copy large tool payloads retained by thinking detail", async () => {
  const largePayload = "x".repeat(512 * 1024);
  const messages = [
    {
      messageUid: "sm-final-assistant",
      ts: TEST_MESSAGE_TS,
      role: "assistant",
      presentationMessageId: "pm_fx10",
      modelMessageId: "mm_session_thinking_detail__8",
      type: "message",
      turnScopeId: "turn-large-detail",
      content: "done",
      toolTimeline: [
        {
          key: "call:large",
          toolCallId: "large",
          status: "completed",
          call: { arguments: largePayload },
          resultEvent: { output: largePayload },
        },
      ],
    },
  ];

  const summary = await buildPersistedDisplaySummary({
    sessionId: "large-session",
    aggregateVersion: 0,
    messages,
  });
  const detail = buildThinkingDetailPayload(
    committedTurn({
      sessionId: "large-session",
      turnScopeId: "turn-large-detail",
      dialogProcessId: "dialog-large-detail",
      messages,
    }),
  );

  assert.equal(JSON.stringify(summary).includes(largePayload), false);
  assert.equal(Object.hasOwn(summary.messages[0], "thinkingDetailCount"), false);
  assert.equal(countCanonicalThinkingDetailEvents(summary.messages[0]), 2);
  assert.equal(detail.messageItem.toolTimeline[0].call.arguments, largePayload);
  assert.equal(detail.messageItem.toolTimeline[0].resultEvent.output, largePayload);
  assert.equal(Object.hasOwn(detail, "allMessages"), false);
});

async function withSessionDir(fn) {
  const sessionDir = await mkdtemp(path.join(os.tmpdir(), "noobot-thinking-turn-"));
  try {
    await fn(sessionDir);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
}

test("thinking detail storage lookup reads exactly one canonical Turn journal", async () =>
  withSessionDir(async (sessionDir) => {
    await writeSessionArtifact({
      storageService,
      sessionDir,
      atomic: true,
      predecessor: SESSION_ARTIFACT_PREDECESSOR.CANONICAL,
      sessionPayload: applySessionMessageFacts({
        ...createTestSessionRequiredFields(),
        sessionId: "scoped-session",
        aggregateVersion: 0,
        messages: [
          {
            messageUid: "sm-one",
            ts: TEST_MESSAGE_TS,
            sessionId: "scoped-session",
            role: "assistant",
            presentationMessageId: "pm_fx11",
            modelMessageId: "mm_session_thinking_detail__9",
            type: "message",
            turnScopeId: "turn-one",
            dialogProcessId: "dialog-one",
            content: "one",
            toolTimeline: [{ key: "call:one", status: "completed" }],
          },
          {
            messageUid: "sm-two",
            ts: TEST_MESSAGE_TS,
            sessionId: "scoped-session",
            role: "assistant",
            presentationMessageId: "pm_fx12",
            modelMessageId: "mm_session_thinking_detail__10",
            type: "message",
            turnScopeId: "turn-two",
            dialogProcessId: "dialog-two",
            content: "two",
            toolTimeline: [{ key: "call:two", status: "completed" }],
          },
        ],
      }),
    });

    const manifest = JSON.parse(await readFile(path.join(sessionDir, "session.json"), "utf8"));
    const unrelatedTurn = manifest.turnOrder.find((item) => item.turnScopeId === "turn-one");
    await writeFile(
      path.join(sessionDir, "turns", `${unrelatedTurn.turnId}.jsonl`),
      "not-json\n",
      "utf8",
    );

    const lookupKey = { turnScopeId: "turn-two", dialogProcessId: "dialog-two" };
    const turn = await readSessionTurn({ storageService, sessionDir, ...lookupKey });
    assert.equal(turn.turnScopeId, "turn-two");
    assert.ok(turn.committedBytes > 0);
    assert.equal(Object.hasOwn(turn, "aggregateVersion"), false);
    assert.deepEqual(
      turn.messages.map((message) => message.messageUid),
      ["sm-two"],
    );

    const detail = await readSessionThinkingDetail({ storageService, sessionDir, ...lookupKey });
    assert.equal(detail.exists, true);
    assert.equal(detail.sessionId, "scoped-session");
    assert.equal(detail.revision, createTurnArtifactRevision(turn));
    assert.equal(detail.messageItem.presentationMessageId, "pm_fx12");
    assert.equal(detail.messageItem.toolTimeline.length, 1);

    assert.deepEqual(
      await readSessionThinkingDetail({
        storageService,
        sessionDir,
        turnScopeId: "turn-two",
        dialogProcessId: "dialog-one",
      }),
      { exists: false },
    );
  }));

test("thinking detail lookup requires both Turn identities", async () =>
  withSessionDir(async (sessionDir) => {
    for (const lookupKey of [
      { turnScopeId: "turn-two" },
      { dialogProcessId: "dialog-two" },
      { turnScopeId: "turn-two", dialogProcessId: "" },
      { turnScopeId: " turn-two ", dialogProcessId: "dialog-two" },
    ]) {
      await assert.rejects(
        readSessionThinkingDetail({ storageService, sessionDir, ...lookupKey }),
        {
          code: SESSION_ERROR_CODE.TURN_LOOKUP_KEY_INVALID,
          statusCode: 400,
        },
      );
    }
  }));

test("thinking detail lookup of a missing Session manifest reports the artifact as not found", async () =>
  withSessionDir(async (sessionDir) => {
    await assert.rejects(
      readSessionThinkingDetail({
        storageService,
        sessionDir,
        turnScopeId: "turn-two",
        dialogProcessId: "dialog-two",
      }),
      { code: SESSION_ERROR_CODE.ARTIFACT_NOT_FOUND, statusCode: 404 },
    );
  }));
