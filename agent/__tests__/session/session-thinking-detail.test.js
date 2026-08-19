/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { buildThinkingDetailPayload } from "../../src/session/session-thinking-detail.js";
import { buildSessionDisplaySummary } from "../../src/session/session-summary-builders.js";
import { readSessionTurn, writeSessionArtifact } from "../../src/session/session-artifact-store.js";

test("thinking detail message carries its session identity without duplicating scoped messages", () => {
  const payload = buildThinkingDetailPayload({
    sessionId: "session-detail",
    sessions: [{
      sessionId: "session-detail",
      rawMessages: [
        {
          role: "assistant",
          type: "message",
          turnScopeId: "turn-detail",
          toolTimeline: [{ key: "call:one" }],
        },
        {
          role: "assistant",
          type: "message",
          turnScopeId: "turn-detail",
          injectedMessage: true,
          content: "guidance",
        },
      ],
    }],
  }, { turnScopeId: "turn-detail" });

  assert.equal(payload.messageItem.sessionId, "session-detail");
  assert.equal(Object.hasOwn(payload, "allMessages"), false);
  assert.equal(payload.counts.injectedMessageCount, 1);
});

test("thinking detail projects the complete turn timeline onto the final assistant message", () => {
  const payload = buildThinkingDetailPayload({
    sessionId: "child-session",
    sessions: [{
      sessionId: "child-session",
      rawMessages: [
        {
          id: "tool-call-message",
          role: "assistant",
          type: "tool_call",
          turnScopeId: "workflow-node:turn-1",
          toolTimeline: [{ key: "call:one", status: "running", call: { eventId: "call-start" } }],
        },
        {
          id: "tool-result-message",
          role: "tool",
          type: "tool_result",
          turnScopeId: "workflow-node:turn-1",
          toolTimeline: [{ key: "call:one", status: "completed", resultEvent: { eventId: "call-end" } }],
        },
        {
          id: "final-assistant",
          role: "assistant",
          type: "message",
          turnScopeId: "workflow-node:turn-1",
          content: "done",
          activityTimeline: [{ eventId: "analysis-1", eventType: "thinking" }],
        },
      ],
    }],
  }, { turnScopeId: "workflow-node:turn-1" });

  assert.equal(payload.messageItem.id, "final-assistant");
  assert.equal(payload.messageItem.toolTimeline.length, 1);
  assert.equal(payload.messageItem.toolTimeline[0].status, "completed");
  assert.equal(payload.messageItem.toolTimeline[0].call.eventId, "call-start");
  assert.equal(payload.messageItem.toolTimeline[0].resultEvent.eventId, "call-end");
  assert.equal(payload.messageItem.activityTimeline.length, 1);
  assert.equal(payload.messageItem.hasThinkingDetails, true);
  assert.equal(payload.counts.executionLogCount, 2);
});

test("thinking detail publishes its authoritative source revision", () => {
  const payload = buildThinkingDetailPayload({
    sessionId: "revision-session",
    revision: "sha256:thinking-detail-content",
    sessions: [{
      sessionId: "revision-session",
      rawMessages: [{
        role: "assistant",
        type: "message",
        turnScopeId: "revision-turn",
      }],
    }],
  }, { turnScopeId: "revision-turn" });

  assert.equal(payload.revision, "sha256:thinking-detail-content");
});

test("stopped turn detail uses the persisted presentation identity without a final answer", () => {
  const payload = buildThinkingDetailPayload({
    sessionId: "stopped-session",
    sessions: [{
      sessionId: "stopped-session",
      rawMessages: [{
        id: "tool-call-message",
        role: "assistant",
        type: "tool_call",
        chatPresentation: false,
        sessionId: "stopped-session",
        dialogProcessId: "stopped-dialog",
        turnScopeId: "stopped-turn",
        presentationMessageId: "stopped-presentation",
        toolTimeline: [{
          key: "call:one",
          toolCallId: "one",
          call: { eventId: "call-one" },
          resultEvent: { eventId: "result-one" },
        }],
      }],
    }],
  }, { turnScopeId: "stopped-turn" });

  assert.equal(payload.exists, true);
  assert.equal(payload.messageItem.role, "assistant");
  assert.equal(payload.messageItem.type, "message");
  assert.equal(payload.messageItem.presentationMessageId, "stopped-presentation");
  assert.equal(payload.messageItem.turnScopeId, "stopped-turn");
  assert.equal(payload.messageItem.thinkingDetailCount, 2);
  assert.equal(payload.counts.executionLogCount, 2);
});

test("session summary references canonical thinking detail without copying its timeline", () => {
  const messages = [
    {
      id: "tool-call-one",
      role: "assistant",
      type: "tool_call",
      turnScopeId: "workflow-node:turn-2",
      toolTimeline: [{
        key: "call:one",
        toolCallId: "one",
        status: "completed",
        call: { eventId: "call-one" },
        resultEvent: { eventId: "result-one" },
      }],
    },
    {
      id: "tool-call-two",
      role: "assistant",
      type: "tool_call",
      turnScopeId: "workflow-node:turn-2",
      toolTimeline: [{
        key: "call:two",
        toolCallId: "two",
        status: "completed",
        call: { eventId: "call-two" },
        resultEvent: { eventId: "result-two" },
      }],
    },
    {
      id: "final-assistant",
      role: "assistant",
      type: "message",
      turnScopeId: "workflow-node:turn-2",
      content: "done",
    },
  ];

  const summary = buildSessionDisplaySummary({ sessionId: "child-session", messages });
  const summaryMessage = summary.messages.find((item) => item.id === "final-assistant");
  const detail = buildThinkingDetailPayload({
    sessionId: "child-session",
    sessions: [{ sessionId: "child-session", rawMessages: messages }],
  }, { turnScopeId: "workflow-node:turn-2" });

  assert.equal(summaryMessage.thinkingDetailCount, 4);
  assert.equal(summaryMessage.hasThinkingDetails, true);
  assert.equal(summaryMessage.toolTimeline.length, 2);
  assert.equal(summaryMessage.activityTimeline, undefined);
  assert.equal(detail.messageItem.thinkingDetailCount, summaryMessage.thinkingDetailCount);
  assert.equal(detail.messageItem.toolTimeline.length, 2);
});

test("session summary does not copy large tool payloads retained by thinking detail", () => {
  const largePayload = "x".repeat(512 * 1024);
  const messages = [{
    id: "final-assistant",
    role: "assistant",
    type: "message",
    turnScopeId: "turn-large-detail",
    content: "done",
    toolTimeline: [{
      key: "call:large",
      toolCallId: "large",
      status: "completed",
      call: { arguments: largePayload },
      resultEvent: { output: largePayload },
    }],
  }];

  const summary = buildSessionDisplaySummary({ sessionId: "large-session", messages });
  const detail = buildThinkingDetailPayload({
    sessionId: "large-session",
    sessions: [{ sessionId: "large-session", rawMessages: messages }],
  }, { turnScopeId: "turn-large-detail" });

  assert.equal(JSON.stringify(summary).includes(largePayload), false);
  assert.equal(summary.messages[0].thinkingDetailCount, 2);
  assert.equal(detail.messageItem.toolTimeline[0].call.arguments, largePayload);
  assert.equal(detail.messageItem.toolTimeline[0].resultEvent.output, largePayload);
  assert.equal(Object.hasOwn(detail, "allMessages"), false);
});

test("thinking detail storage lookup reads exactly one canonical Turn journal", async () => {
  const sessionDir = await mkdtemp(path.join(os.tmpdir(), "noobot-thinking-turn-"));
  try {
    await writeSessionArtifact({
      sessionDir,
      sessionPayload: {
        sessionId: "scoped-session",
        messages: [{
          messageUid: "sm-one",
          role: "assistant",
          type: "message",
          turnScopeId: "turn-one",
          dialogProcessId: "dialog-one",
          content: "one",
          toolTimeline: [{ key: "call:one", status: "completed" }],
        }, {
          messageUid: "sm-two",
          role: "assistant",
          type: "message",
          turnScopeId: "turn-two",
          dialogProcessId: "dialog-two",
          content: "two",
          toolTimeline: [{ key: "call:two", status: "completed" }],
        }],
      },
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
    assert.deepEqual(turn.messages.map((message) => message.messageUid), ["sm-two"]);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});
