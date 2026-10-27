/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { countCanonicalThinkingDetailEvents } from "@noobot/event-protocol/tool-timeline";
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { buildThinkingDetailPayload } from "../../src/session/session-thinking-detail.js";
import { buildSessionDisplaySummary } from "../../src/session/session-summary-builders.js";
import { readSessionTurn, writeSessionArtifact } from "../../src/session/session-artifact-store.js";
import { canonicalActivity } from "./session-repository-boundary.summaries.fixtures.js";
import {
  applySessionMessageFacts,
  createTestSessionRequiredFields,
} from "../helpers/session-message-facts.js";
import { TEST_MESSAGE_TS } from "../helpers/session-run-payload.js";

test("thinking detail message carries its session identity without duplicating scoped messages", () => {
  const payload = buildThinkingDetailPayload(
    {
      sessionId: "session-detail",
      sessions: [
        {
          sessionId: "session-detail",
          rawMessages: [
            {
              messageUid: "final-assistant-source",
              ts: TEST_MESSAGE_TS,
              role: "assistant",
              presentationMessageId: "pm_turn_detail",
              modelMessageId: "mm_session_thinking_detail__1",
              type: "message",
              turnScopeId: "turn-detail",
              toolTimeline: [{ key: "call:one" }],
            },
            {
              messageUid: "guidance-source",
              ts: TEST_MESSAGE_TS,
              role: "assistant",
              presentationMessageId: "pm_turn_detail",
              modelMessageId: "mm_session_thinking_detail__2",
              type: "message",
              turnScopeId: "turn-detail",
              injectedMessage: true,
              content: "guidance",
            },
          ],
        },
      ],
    },
    { turnScopeId: "turn-detail" },
  );

  assert.equal(payload.messageItem.sessionId, "session-detail");
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
      sessionId: "",
      dialogProcessId: "",
      turnScopeId: "turn-detail",
      presentationMessageId: "pm_turn_detail",
    },
  ]);
  assert.equal(payload.counts.thinkingContentCount, 1);
});

test("thinking detail projects only activity facts, not assistant tool-call content, and excludes control injections", () => {
  const payload = buildThinkingDetailPayload(
    {
      sessionId: "content-session",
      sessions: [
        {
          sessionId: "content-session",
          rawMessages: [
            {
              messageUid: "assistant-tool-source",
              ts: TEST_MESSAGE_TS,
              modelMessageId: "presentation-content",
              role: "assistant",
              type: "tool_call",
              turnScopeId: "content-turn",
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
              turnScopeId: "content-turn",
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
              turnScopeId: "content-turn",
              content: "done",
            },
          ],
        },
      ],
    },
    { turnScopeId: "content-turn" },
  );

  assert.deepEqual(
    payload.messageItem.thinkingContentTimeline.map((item) => [item.contentKind, item.text]),
    [["thinking", "analysis"]],
  );
  assert.equal(payload.counts.injectedMessageCount, 0);
  assert.equal(payload.counts.thinkingContentCount, 1);
});

test("thinking detail projects the complete turn timeline onto the final assistant message", () => {
  const payload = buildThinkingDetailPayload(
    {
      sessionId: "child-session",
      sessions: [
        {
          sessionId: "child-session",
          rawMessages: [
            {
              messageUid: "sm-tool-call-message",
              ts: TEST_MESSAGE_TS,
              role: "assistant",
              presentationMessageId: "final-assistant",
              modelMessageId: "mm_session_thinking_detail__4",
              type: "tool_call",
              turnScopeId: "workflow-node:turn-1",
              toolTimeline: [
                { key: "call:one", status: "running", call: { eventId: "call-start" } },
              ],
            },
            {
              messageUid: "sm-tool-result-message",
              ts: TEST_MESSAGE_TS,
              role: "tool",
              presentationMessageId: "final-assistant",
              type: "tool_result",
              turnScopeId: "workflow-node:turn-1",
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
              turnScopeId: "workflow-node:turn-1",
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
        },
      ],
    },
    { turnScopeId: "workflow-node:turn-1" },
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

test("thinking detail publishes its authoritative source revision", () => {
  const payload = buildThinkingDetailPayload(
    {
      sessionId: "revision-session",
      revision: "sha256:thinking-detail-content",
      sessions: [
        {
          sessionId: "revision-session",
          rawMessages: [
            {
              role: "assistant",
              presentationMessageId: "pm_fx7",
              modelMessageId: "mm_session_thinking_detail__6",
              type: "message",
              turnScopeId: "revision-turn",
            },
          ],
        },
      ],
    },
    { turnScopeId: "revision-turn" },
  );

  assert.equal(payload.revision, "sha256:thinking-detail-content");
});

test("stopped turn detail uses the persisted presentation identity without a final answer", () => {
  const payload = buildThinkingDetailPayload(
    {
      sessionId: "stopped-session",
      sessions: [
        {
          sessionId: "stopped-session",
          rawMessages: [
            {
              messageUid: "sm-tool-call-message",
              ts: TEST_MESSAGE_TS,
              role: "assistant",
              modelMessageId: "mm_session_thinking_detail__7",
              type: "tool_call",
              chatPresentation: false,
              sessionId: "stopped-session",
              dialogProcessId: "stopped-dialog",
              turnScopeId: "stopped-turn",
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
        },
      ],
    },
    { turnScopeId: "stopped-turn" },
  );

  assert.equal(payload.exists, true);
  assert.equal(payload.messageItem.role, "assistant");
  assert.equal(payload.messageItem.type, "message");
  assert.equal(payload.messageItem.presentationMessageId, "stopped-presentation");
  assert.equal(payload.messageItem.turnScopeId, "stopped-turn");
  assert.equal(Object.hasOwn(payload.messageItem, "thinkingDetailCount"), false);
  assert.equal(countCanonicalThinkingDetailEvents(payload.messageItem), 2);
  assert.equal(payload.counts.executionLogCount, 2);
});

test("session summary references canonical thinking detail without copying its timeline", () => {
  const messages = [
    {
      modelMessageId: "tool-call-one",
      role: "assistant",
      presentationMessageId: "pm_workflow_turn_2",
      type: "tool_call",
      turnScopeId: "workflow-node:turn-2",
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
      presentationMessageId: "pm_workflow_turn_2",
      type: "tool_call",
      turnScopeId: "workflow-node:turn-2",
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
      content: "done",
    },
  ];

  const summary = buildSessionDisplaySummary({
    ...createTestSessionRequiredFields(),
    sessionId: "child-session",
    aggregateVersion: 0,
    messages,
  });
  const summaryMessage = summary.messages.find(
    (item) => item.presentationMessageId === "final-assistant",
  );
  const detail = buildThinkingDetailPayload(
    {
      sessionId: "child-session",
      sessions: [{ sessionId: "child-session", rawMessages: messages }],
    },
    { turnScopeId: "workflow-node:turn-2" },
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

test("session summary does not copy large tool payloads retained by thinking detail", () => {
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

  const summary = buildSessionDisplaySummary({
    ...createTestSessionRequiredFields(),
    sessionId: "large-session",
    aggregateVersion: 0,
    messages,
  });
  const detail = buildThinkingDetailPayload(
    {
      sessionId: "large-session",
      sessions: [{ sessionId: "large-session", rawMessages: messages }],
    },
    { turnScopeId: "turn-large-detail" },
  );

  assert.equal(JSON.stringify(summary).includes(largePayload), false);
  assert.equal(Object.hasOwn(summary.messages[0], "thinkingDetailCount"), false);
  assert.equal(countCanonicalThinkingDetailEvents(summary.messages[0]), 2);
  assert.equal(detail.messageItem.toolTimeline[0].call.arguments, largePayload);
  assert.equal(detail.messageItem.toolTimeline[0].resultEvent.output, largePayload);
  assert.equal(Object.hasOwn(detail, "allMessages"), false);
});

test("thinking detail storage lookup reads exactly one canonical Turn journal", async () => {
  const sessionDir = await mkdtemp(path.join(os.tmpdir(), "noobot-thinking-turn-"));
  try {
    await writeSessionArtifact({
      sessionDir,
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

    const turn = await readSessionTurn({ sessionDir, turnScopeId: "turn-two" });
    assert.equal(turn.turnScopeId, "turn-two");
    assert.ok(turn.committedBytes > 0);
    assert.equal(Object.hasOwn(turn, "aggregateVersion"), false);
    assert.deepEqual(
      turn.messages.map((message) => message.messageUid),
      ["sm-two"],
    );
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});
