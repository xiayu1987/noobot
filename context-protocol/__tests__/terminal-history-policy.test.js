/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  projectTerminalHistoryMessages,
} from "../src/terminal-history-policy.js";

function message(overrides = {}) {
  return {
    messageUid: overrides.messageUid || `m_${Math.random()}`,
    role: "user",
    content: "",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    ...overrides,
  };
}

function status(overrides = {}) {
  return {
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    status: "user_stopped",
    reason: "user_stop",
    description: "用户停止了本轮生成",
    ...overrides,
  };
}

test("user-stopped history ignores summary flags and projects only user, latest injection per category, and user explanation", () => {
  const source = [
    message({ messageUid: "user-1", content: "原始问题", frontendUserMessage: true, summarized: true }),
    message({ messageUid: "guide-old", content: "旧 guidance", injectedMessage: true, injectedBy: "harness-plugin", injectedMessageType: "guidance", summarized: true }),
    message({ messageUid: "plan", content: "最新 planning", injectedMessage: true, injectedBy: "harness-plugin", injectedMessageType: "planning", summarized: true }),
    message({ messageUid: "call", role: "assistant", tool_calls: [{ id: "call-1", name: "read" }] }),
    message({ messageUid: "result", role: "tool", tool_call_id: "call-1", content: "large tool result" }),
    message({ messageUid: "guide-new", content: "最新 guidance", injectedMessage: true, injectedBy: "harness-plugin", injectedMessageType: "guidance" }),
    message({ messageUid: "partial", role: "assistant", content: "partial answer" }),
  ];

  const result = projectTerminalHistoryMessages({ messages: source, turnStatuses: [status()] });

  assert.deepEqual(result.map((item) => item.messageUid), [
    "user-1",
    "plan",
    "guide-new",
    "turn-1::terminal_status",
  ]);
  assert.deepEqual(result.map((item) => item.role), ["user", "user", "user", "user"]);
  assert.ok(result.every((item) => item.summarized === false));
  assert.ok(result.every((item) => item.terminalHistoryProjection === true));
  assert.deepEqual(result.at(-1), {
    messageUid: "turn-1::terminal_status",
    role: "user",
    type: "message",
    content: "用户停止了本轮生成",
    dialogProcessId: "dialog-1",
    parentDialogProcessId: "",
    turnScopeId: "turn-1",
    summarized: false,
    terminalHistoryProjection: true,
    terminalHistoryExplanation: true,
    terminalStatus: "user_stopped",
    terminalReason: "user_stop",
    messageOrigin: "internal",
    additional_kwargs: {
      noobotMessageId: "turn-1::terminal_status",
      noobotInternalMessageType: "terminal_history_explanation",
      terminalStatus: "user_stopped",
      terminalReason: "user_stop",
    },
  });
});

for (const terminalStatus of ["error", "timeout"]) {
  test(`${terminalStatus} history projects the authoritative explanation as assistant`, () => {
    const result = projectTerminalHistoryMessages({
      messages: [message({ messageUid: "user-1", content: "原始问题", frontendUserMessage: true })],
      turnStatuses: [status({
        status: terminalStatus,
        reason: terminalStatus === "error" ? "run_error" : "run_timeout",
        description: terminalStatus === "error" ? "本轮对话异常停止" : "本轮对话运行超时",
      })],
    });

    assert.equal(result.length, 2);
    assert.equal(result[1].role, "assistant");
    assert.equal(result[1].terminalStatus, terminalStatus);
    assert.equal(result[1].content, terminalStatus === "error" ? "本轮对话异常停止" : "本轮对话运行超时");
  });
}

test("completed rounds remain untouched for summarized filtering by the history reducer", () => {
  const source = [
    message({ messageUid: "user-1", content: "question", frontendUserMessage: true }),
    message({ messageUid: "answer-1", role: "assistant", content: "answer", summarized: true }),
  ];
  const result = projectTerminalHistoryMessages({
    messages: source,
    turnStatuses: [status({ status: "completed", reason: "run_completed" })],
  });
  assert.equal(result, source);
  assert.equal(result[1].summarized, true);
});

test("latest injected selection is scoped independently to each terminal dialog", () => {
  const source = [
    message({ messageUid: "u1", content: "q1", frontendUserMessage: true }),
    message({ messageUid: "g1", content: "g1", injectedMessage: true, injectedBy: "harness-plugin", injectedMessageType: "guidance" }),
    message({ messageUid: "u2", content: "q2", frontendUserMessage: true, dialogProcessId: "dialog-2", turnScopeId: "turn-2" }),
    message({ messageUid: "g2", content: "g2", injectedMessage: true, injectedBy: "harness-plugin", injectedMessageType: "guidance", dialogProcessId: "dialog-2", turnScopeId: "turn-2" }),
  ];
  const result = projectTerminalHistoryMessages({
    messages: source,
    turnStatuses: [
      status(),
      status({ dialogProcessId: "dialog-2", turnScopeId: "turn-2" }),
    ],
  });
  assert.deepEqual(result.map((item) => item.messageUid), [
    "u1", "g1", "turn-1::terminal_status",
    "u2", "g2", "turn-2::terminal_status",
  ]);
});

test("terminal status requires the complete round identity", () => {
  assert.throws(
    () => projectTerminalHistoryMessages({ messages: [], turnStatuses: [status({ turnScopeId: "" })] }),
    /requires dialogProcessId and turnScopeId/,
  );
});

test("terminal status requires its authoritative explanation", () => {
  assert.throws(
    () => projectTerminalHistoryMessages({
      messages: [message({ messageUid: "user-1", frontendUserMessage: true })],
      turnStatuses: [status({ description: "" })],
    }),
    /requires an explanation description/,
  );
});

test("terminal status cannot outlive all canonical messages in its round", () => {
  assert.throws(
    () => projectTerminalHistoryMessages({ messages: [], turnStatuses: [status()] }),
    /has no canonical round messages/,
  );
});

test("terminal history requires its canonical frontend user message", () => {
  assert.throws(
    () => projectTerminalHistoryMessages({
      messages: [message({ messageUid: "tool-1", role: "tool" })],
      turnStatuses: [status()],
    }),
    /missing its canonical frontend user message/,
  );
});
