/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  collectDialogScopedMessagesToSummarize,
  collectLatestCheckpointEvidenceMessageIndexes,
  collectScopedMessagesToSummarize,
  markCurrentTurnArraySummarized,
  markScopedMessagesSummarized,
} from "../src/policy/summary.js";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "../src/message/injected-types.js";
import { FLOW_CONTROL_ROLE, createFlowControlContextPolicy } from "../src/tool/context-policy.js";

const boundaryPolicy = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_BOUNDARY);
const evidencePolicy = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE);

function flowCall(id, name, contextPolicy) {
  return { id, name, contextPolicy };
}

function flowResult(id, toolName, content, contextPolicy) {
  return { role: "tool", tool_call_id: id, toolName, content, contextPolicy };
}

test("checkpoint evidence selection retains the latest closed batch per canonical tool identity", () => {
  const messages = [
    { role: "assistant", tool_calls: [flowCall("old", "plan_control", evidencePolicy)] },
    flowResult("old", "plan_control", "old", evidencePolicy),
    { role: "assistant", tool_calls: [flowCall("accept", "accept_control", evidencePolicy)] },
    flowResult("accept", "accept_control", "accepted", evidencePolicy),
    { role: "assistant", tool_calls: [{ id: "business", name: "execute_script" }] },
    { role: "tool", tool_call_id: "business", toolName: "execute_script", content: "ok" },
    {
      role: "assistant",
      tool_calls: [
        flowCall("latest", "plan_control", evidencePolicy),
        { id: "parallel", name: "read_file" },
      ],
    },
    flowResult("latest", "plan_control", "latest", evidencePolicy),
    { role: "tool", tool_call_id: "parallel", toolName: "read_file", content: "file" },
  ];

  assert.deepEqual(
    [...collectLatestCheckpointEvidenceMessageIndexes(messages)].sort(
      (left, right) => left - right,
    ),
    [2, 3, 6, 7, 8],
  );
});

test("checkpoint evidence pairs a persisted tool result by tool_call_id, not its message id", () => {
  const messages = [
    {
      messageUid: "evidence-call-message",
      id: "assistant-provider-message",
      role: "assistant",
      type: "tool_call",
      tool_calls: [flowCall("evidence-call", "flow_evidence", evidencePolicy)],
    },
    {
      messageUid: "evidence-result-message",
      id: "tool-result-message",
      role: "tool",
      type: "tool_result",
      tool_call_id: "evidence-call",
      content: "recorded",
    },
  ];

  assert.deepEqual([...collectLatestCheckpointEvidenceMessageIndexes(messages)], [0, 1]);
  assert.deepEqual(
    markCurrentTurnArraySummarized(messages).map((message) => message.summarized === true),
    [false, false],
  );
});

test("an unclassified tool name is never inferred to be checkpoint evidence", () => {
  const messages = [
    { role: "assistant", tool_calls: [{ id: "fake", name: "task_check" }] },
    { role: "tool", tool_call_id: "fake", toolName: "task_check", content: "not classified" },
  ];

  assert.deepEqual([...collectLatestCheckpointEvidenceMessageIndexes(messages)], []);
  assert.deepEqual(collectScopedMessagesToSummarize(messages).messages, messages);
});

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

  assert.deepEqual(
    selected.map((message) => message.additional_kwargs.noobotMessageId),
    ["d1-old", "d2-old"],
  );
});

test("summary policy preserves latest task summary pair and latest injection", () => {
  const result = markCurrentTurnArraySummarized([
    { role: "assistant", tool_calls: [flowCall("old", "summary_control", boundaryPolicy)] },
    flowResult("old", "summary_control", "old", boundaryPolicy),
    {
      role: "user",
      injectedMessage: true,
      injectedBy: "plugin",
      injectedMessageType: "guidance",
      content: "old guidance",
    },
    { role: "assistant", tool_calls: [flowCall("latest", "summary_control", boundaryPolicy)] },
    flowResult("latest", "summary_control", "latest", boundaryPolicy),
    {
      role: "user",
      injectedMessage: true,
      injectedBy: "plugin",
      injectedMessageType: "guidance",
      content: "latest guidance",
    },
  ]);

  assert.deepEqual(
    result.map((message) => message.summarized === true),
    [true, true, true, false, false, false],
  );
});

test("checkpoint control prompts are summarized while normal injections retain their latest type", () => {
  const messages = [
    {
      role: "user",
      injectedMessage: true,
      injectedBy: "plugin",
      injectedMessageType: "guidance",
      content: "old",
    },
    {
      role: "user",
      injectedMessage: true,
      injectedBy: "plugin",
      injectedMessageType: "guidance",
      content: "latest",
    },
    {
      role: "user",
      content: "summary prompt",
      additional_kwargs: {
        noobotInternalMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_PROMPT,
      },
    },
    {
      role: "user",
      content: "check prompt",
      additional_kwargs: {
        noobotInternalMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.TASK_CHECK_PROMPT,
      },
    },
  ];

  const result = markCurrentTurnArraySummarized(messages);
  const selected = collectScopedMessagesToSummarize(messages).messages;

  assert.deepEqual(
    result.map((message) => message.summarized === true),
    [true, false, true, true],
  );
  assert.deepEqual(selected, [messages[0], messages[2], messages[3]]);
});

test("summary checkpoint preserves only the latest task_check call and result pair", () => {
  const result = markCurrentTurnArraySummarized([
    { role: "assistant", tool_calls: [flowCall("check-old", "check_control", evidencePolicy)] },
    flowResult("check-old", "check_control", "old", evidencePolicy),
    { role: "assistant", tool_calls: [{ id: "business", name: "execute_script" }] },
    { role: "tool", tool_call_id: "business", toolName: "execute_script", content: "ok" },
    { role: "assistant", tool_calls: [flowCall("check-latest", "check_control", evidencePolicy)] },
    flowResult("check-latest", "check_control", "latest", evidencePolicy),
    { role: "assistant", tool_calls: [flowCall("summary", "summary_control", boundaryPolicy)] },
    flowResult("summary", "summary_control", "summary", boundaryPolicy),
  ]);

  assert.deepEqual(
    result.map((message) => message.summarized === true),
    [true, true, true, true, false, false, false, false],
  );
});

test("summary selection keeps a parallel tool-call batch atomic when task_check is preserved", () => {
  const assistant = {
    role: "assistant",
    tool_calls: [
      { id: "read-a", name: "read_file" },
      { id: "read-b", name: "read_file" },
      flowCall("check", "check_control", evidencePolicy),
    ],
  };
  const messages = [
    assistant,
    { role: "tool", tool_call_id: "read-a", toolName: "read_file", content: "a" },
    { role: "tool", tool_call_id: "read-b", toolName: "read_file", content: "b" },
    flowResult("check", "check_control", "check", evidencePolicy),
  ];

  const selected = collectScopedMessagesToSummarize(messages).messages;
  const marked = markCurrentTurnArraySummarized(messages);

  assert.deepEqual(selected, []);
  assert.deepEqual(
    marked.map((message) => message.summarized === true),
    [false, false, false, false],
  );
});

test("summary selection does not select an incomplete parallel tool-call batch", () => {
  const messages = [
    {
      role: "assistant",
      tool_calls: [
        { id: "read-a", name: "read_file" },
        { id: "read-b", name: "read_file" },
      ],
    },
    { role: "tool", tool_call_id: "read-a", toolName: "read_file", content: "a" },
  ];

  assert.deepEqual(collectScopedMessagesToSummarize(messages).messages, []);
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
