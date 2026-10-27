/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";

import { projectTerminalHistoryMessages } from "../src/policy/terminal-history.js";
import {
  readContextMessageField,
  readContextMessageValue,
  composeContextProjectionKey,
  resolveContextMessageKey,
  resolveContextMessageSummarized,
} from "../src/message/codec.js";
import { contextMessage } from "./helpers/context-message.js";

function message(overrides = {}) {
  return contextMessage({
    messageUid: overrides.messageUid || `m_${Math.random()}`,
    role: "user",
    content: "",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    ...overrides,
  });
}

const ids = (messages) => messages.map(resolveContextMessageKey);
const terminalKey = (turnScopeId) => composeContextProjectionKey("terminal_status", turnScopeId);

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
    message({
      messageUid: "user-1",
      content: "原始问题",
      messageOrigin: "natural",
      summarized: true,
    }),
    message({
      messageUid: "guide-old",
      content: "旧 guidance",
      injectedMessage: true,
      injectedBy: "harness-plugin",
      injectedMessageType: "guidance",
      summarized: true,
    }),
    message({
      messageUid: "plan",
      content: "最新 planning",
      injectedMessage: true,
      injectedBy: "harness-plugin",
      injectedMessageType: "planning",
      summarized: true,
    }),
    message({
      messageUid: "call",
      role: "assistant",
      tool_calls: [{ id: "call-1", name: "read" }],
    }),
    message({
      messageUid: "result",
      role: "tool",
      tool_call_id: "call-1",
      content: "large tool result",
    }),
    message({
      messageUid: "guide-new",
      content: "最新 guidance",
      injectedMessage: true,
      injectedBy: "harness-plugin",
      injectedMessageType: "guidance",
    }),
    message({ messageUid: "partial", role: "assistant", content: "partial answer" }),
  ];

  const result = projectTerminalHistoryMessages({ messages: source, terminalStatuses: [status()] });

  assert.deepEqual(ids(result), ["user-1", "plan", "guide-new", terminalKey("turn-1")]);
  assert.deepEqual(
    result.map((item) => item.role),
    ["user", "user", "user", "user"],
  );
  assert.ok(result.every((item) => resolveContextMessageSummarized(item) === false));
  assert.ok(
    result.every((item) => readContextMessageValue(item, "terminalHistoryProjection") === true),
  );

  assert.equal(resolveContextMessageSummarized(source[0]), true);
  assert.deepEqual(result.at(-1), {
    role: "user",
    content: "用户停止了本轮生成",
    additional_kwargs: {
      projectionType: "terminal_status",
      sourceTurnScopeId: "turn-1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      noobotInternalMessageType: "terminal_history_explanation",
      terminalHistoryProjection: true,
      terminalHistoryExplanation: true,
      terminalStatus: "user_stopped",
      terminalReason: "user_stop",
    },
  });
});

for (const terminalStatus of ["error", "timeout"]) {
  test(`${terminalStatus} history projects the authoritative explanation as assistant`, () => {
    const result = projectTerminalHistoryMessages({
      messages: [
        message({
          messageUid: "user-1",
          content: "原始问题",
          messageOrigin: "natural",
        }),
      ],
      terminalStatuses: [
        status({
          status: terminalStatus,
          reason: terminalStatus === "error" ? "run_error" : "run_timeout",
          description: terminalStatus === "error" ? "本轮对话异常停止" : "本轮对话运行超时",
        }),
      ],
    });

    assert.equal(result.length, 2);
    assert.equal(result[1].role, "assistant");
    assert.equal(readContextMessageField(result[1], "terminalStatus"), terminalStatus);
    assert.equal(
      result[1].content,
      terminalStatus === "error" ? "本轮对话异常停止" : "本轮对话运行超时",
    );
  });
}

test("completed rounds remain untouched for summarized filtering by the history reducer", () => {
  const source = [
    message({
      messageUid: "user-1",
      content: "question",
      messageOrigin: "natural",
    }),
    message({ messageUid: "answer-1", role: "assistant", content: "answer", summarized: true }),
  ];
  const result = projectTerminalHistoryMessages({
    messages: source,
    terminalStatuses: [status({ status: "completed", reason: "run_completed" })],
  });
  assert.equal(result, source);
  assert.equal(resolveContextMessageSummarized(result[1]), true);
});

test("latest injected selection is scoped independently to each terminal dialog", () => {
  const source = [
    message({
      messageUid: "u1",
      content: "q1",
      messageOrigin: "natural",
    }),
    message({
      messageUid: "g1",
      content: "g1",
      injectedMessage: true,
      injectedBy: "harness-plugin",
      injectedMessageType: "guidance",
    }),
    message({
      messageUid: "u2",
      content: "q2",
      messageOrigin: "natural",
      dialogProcessId: "dialog-2",
      turnScopeId: "turn-2",
    }),
    message({
      messageUid: "g2",
      content: "g2",
      injectedMessage: true,
      injectedBy: "harness-plugin",
      injectedMessageType: "guidance",
      dialogProcessId: "dialog-2",
      turnScopeId: "turn-2",
    }),
  ];
  const result = projectTerminalHistoryMessages({
    messages: source,
    terminalStatuses: [status(), status({ dialogProcessId: "dialog-2", turnScopeId: "turn-2" })],
  });
  assert.deepEqual(ids(result), [
    "u1",
    "g1",
    terminalKey("turn-1"),
    "u2",
    "g2",
    terminalKey("turn-2"),
  ]);
});

test("terminal status requires the complete round identity", () => {
  assert.throws(
    () =>
      projectTerminalHistoryMessages({
        messages: [],
        terminalStatuses: [status({ turnScopeId: "" })],
      }),
    /requires dialogProcessId and turnScopeId/,
  );
});

test("terminal status requires its authoritative explanation", () => {
  assert.throws(
    () =>
      projectTerminalHistoryMessages({
        messages: [message({ messageUid: "user-1", messageOrigin: "natural" })],
        terminalStatuses: [status({ description: "" })],
      }),
    /requires an explanation description/,
  );
});

test("terminal history fails closed when the terminal identity has no canonical messages", () => {
  const source = [
    message({ messageUid: "prior", turnScopeId: "prior-turn", dialogProcessId: "prior-dialog" }),
  ];
  assert.throws(
    () =>
      projectTerminalHistoryMessages({
        messages: source,
        terminalStatuses: [status()],
      }),
    /terminal lifecycle is missing canonical messages/,
  );
});

test("terminal history still fails closed when a materialized round lacks its canonical natural user message", () => {
  assert.throws(
    () =>
      projectTerminalHistoryMessages({
        messages: [message({ messageUid: "tool-1", role: "tool" })],
        terminalStatuses: [status()],
      }),
    /missing its canonical natural user message/,
  );
});
