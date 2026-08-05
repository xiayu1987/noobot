/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  collectDialogScopedMessagesToSummarize,
  markCurrentTurnArraySummarized,
  markScopedMessagesSummarized,
} from "../src/summary-policy.js";

test("summary retention keeps the latest injection independently in every dialog", () => {
  const injected = (id, dialogProcessId, content) => ({
    role: "user",
    content,
    dialogProcessId,
    turnScopeId: `turn-${dialogProcessId}`,
    injectedMessage: true,
    injectedBy: "plugin",
    injectedMessageType: "guidance",
    additional_kwargs: { noobotMessageId: id },
  });
  const messages = [
    injected("d1-old", "d1", "old d1"),
    injected("d1-latest", "d1", "latest d1"),
    injected("d2-old", "d2", "old d2"),
    injected("d2-latest", "d2", "latest d2"),
  ];

  const selected = collectDialogScopedMessagesToSummarize(messages, {
    retentionMessages: messages,
  });

  assert.deepEqual(selected.map((message) => message.additional_kwargs.noobotMessageId), [
    "d1-old",
    "d2-old",
  ]);
});

test("summary policy preserves latest task summary pair and latest injection", () => {
  const result = markCurrentTurnArraySummarized([
    { role: "assistant", tool_calls: [{ id: "old", name: "task_summary" }] },
    { role: "tool", tool_call_id: "old", toolName: "task_summary", content: "old" },
    { role: "user", injectedMessage: true, injectedBy: "plugin", injectedMessageType: "guidance", content: "old guidance" },
    { role: "assistant", tool_calls: [{ id: "latest", name: "task_summary" }] },
    { role: "tool", tool_call_id: "latest", toolName: "task_summary", content: "latest" },
    { role: "user", injectedMessage: true, injectedBy: "plugin", injectedMessageType: "guidance", content: "latest guidance" },
  ]);

  assert.deepEqual(result.map((message) => message.summarized === true), [true, true, true, false, false, false]);
});

test("summary checkpoint preserves only the latest task_check call and result pair", () => {
  const result = markCurrentTurnArraySummarized([
    { role: "assistant", tool_calls: [{ id: "check-old", name: "task_check" }] },
    { role: "tool", tool_call_id: "check-old", toolName: "task_check", content: "old" },
    { role: "assistant", tool_calls: [{ id: "business", name: "execute_script" }] },
    { role: "tool", tool_call_id: "business", toolName: "execute_script", content: "ok" },
    { role: "assistant", tool_calls: [{ id: "check-latest", name: "task_check" }] },
    { role: "tool", tool_call_id: "check-latest", toolName: "task_check", content: "latest" },
    { role: "assistant", tool_calls: [{ id: "summary", name: "task_summary" }] },
    { role: "tool", tool_call_id: "summary", toolName: "task_summary", content: "summary" },
  ]);

  assert.deepEqual(
    result.map((message) => message.summarized === true),
    [true, true, true, true, false, false, false, false],
  );
});

test("checkpoint targets use the completed authoritative scope to select one injection per type", () => {
  const oldGuidance = {
    role: "user",
    injectedMessage: true,
    injectedBy: "plugin",
    injectedMessageType: "guidance",
    additional_kwargs: { noobotMessageId: "old-guidance" },
  };
  const latestGuidance = {
    role: "user",
    injectedMessage: true,
    injectedBy: "plugin",
    injectedMessageType: "guidance",
    additional_kwargs: { noobotMessageId: "latest-guidance" },
  };
  const oldSummary = {
    role: "user",
    injectedMessage: true,
    injectedBy: "plugin",
    injectedMessageType: "summary",
    additional_kwargs: { noobotMessageId: "old-summary" },
  };
  const completedSummary = {
    role: "user",
    injectedMessage: true,
    injectedBy: "plugin",
    injectedMessageType: "summary",
    additional_kwargs: { noobotMessageId: "completed-summary" },
  };
  const checkpointTargets = [oldGuidance, latestGuidance, oldSummary];

  const result = markScopedMessagesSummarized(checkpointTargets, {
    retentionMessages: [...checkpointTargets, completedSummary],
  });

  assert.equal(result.changedCount, 2);
  assert.deepEqual(
    checkpointTargets.map((message) => message.summarized === true),
    [true, false, true],
  );
  assert.equal(completedSummary.summarized, undefined);
});

test("summary policy marks restored guidance when a newer guidance exists", () => {
  const restoredGuidance = {
    role: "user",
    content: "restored guidance",
    additional_kwargs: {
      noobotMessageId: "restored-guidance",
      injectedMessage: true,
      injectedBy: "harness-plugin",
      injectedMessageType: "separate_model_relay:guidance",
    },
  };
  const latestGuidance = {
    role: "user",
    content: "latest guidance",
    injectedMessage: true,
    injectedBy: "harness-plugin",
    injectedMessageType: "separate_model_relay:guidance",
    additional_kwargs: { noobotMessageId: "latest-guidance" },
  };

  const result = markCurrentTurnArraySummarized([restoredGuidance, latestGuidance]);

  assert.equal(result[0].summarized, true);
  assert.equal(result[1].summarized, undefined);
});
