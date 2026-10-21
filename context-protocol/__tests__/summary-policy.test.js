/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  collectCurrentTurnSummarizedMessageIndexes,
  collectDialogScopedMessagesToSummarize,
  collectLatestCheckpointEvidenceMessageIndexes,
  collectScopedMessagesToSummarize,
  resolveSummaryScope,
  markScopedMessagesSummarized,
} from "../src/policy/summary.js";
import { isContextControlMessage } from "../src/policy/injected-message.js";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "../src/message/injected-types.js";
import { readContextMessageField, resolveContextMessageSummarized } from "../src/message/codec.js";
import { FLOW_CONTROL_ROLE, createFlowControlContextPolicy } from "../src/tool/context-policy.js";
import { contextMessage } from "./helpers/context-message.js";

const boundaryPolicy = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_BOUNDARY);
const evidencePolicy = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE);

function msg(messageUid, fields = {}) {
  return contextMessage({ ...fields, messageUid });
}

function flowCall(id, name, contextPolicy) {
  return { id, name, contextPolicy };
}

function flowResult(messageUid, id, toolName, content, contextPolicy) {
  return msg(messageUid, { role: "tool", tool_call_id: id, toolName, content, contextPolicy });
}

function assistantCalls(messageUid, toolCalls = []) {
  return msg(messageUid, { role: "assistant", tool_calls: toolCalls });
}

function toolResult(messageUid, id, toolName, content) {
  return msg(messageUid, { role: "tool", tool_call_id: id, toolName, content });
}

function injectedMessage(messageUid, injectedMessageType, content, extra = {}) {
  return msg(messageUid, {
    role: "user",
    content,
    injectedMessage: true,
    injectedBy: "plugin",
    injectedMessageType,
    ...extra,
  });
}

function currentTurnSummarizedFlags(messages = []) {
  const indexes = collectCurrentTurnSummarizedMessageIndexes(messages);
  return messages.map((_, index) => indexes.has(index));
}

test("checkpoint evidence selection retains the latest closed batch per canonical tool identity", () => {
  const messages = [
    assistantCalls("m0", [flowCall("old", "plan_control", evidencePolicy)]),
    flowResult("m1", "old", "plan_control", "old", evidencePolicy),
    assistantCalls("m2", [flowCall("accept", "accept_control", evidencePolicy)]),
    flowResult("m3", "accept", "accept_control", "accepted", evidencePolicy),
    assistantCalls("m4", [{ id: "business", name: "execute_script" }]),
    toolResult("m5", "business", "execute_script", "ok"),
    assistantCalls("m6", [
      flowCall("latest", "plan_control", evidencePolicy),
      { id: "parallel", name: "read_file" },
    ]),
    flowResult("m7", "latest", "plan_control", "latest", evidencePolicy),
    toolResult("m8", "parallel", "read_file", "file"),
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
    msg("evidence-call-message", {
      id: "assistant-provider-message",
      role: "assistant",
      type: "tool_call",
      tool_calls: [flowCall("evidence-call", "flow_evidence", evidencePolicy)],
    }),
    msg("evidence-result-message", {
      id: "tool-result-message",
      role: "tool",
      type: "tool_result",
      tool_call_id: "evidence-call",
      content: "recorded",
    }),
  ];

  assert.deepEqual([...collectLatestCheckpointEvidenceMessageIndexes(messages)], [0, 1]);
  assert.deepEqual(currentTurnSummarizedFlags(messages), [false, false]);
});

test("an unclassified tool name is never inferred to be checkpoint evidence", () => {
  const messages = [
    assistantCalls("m0", [{ id: "fake", name: "task_check" }]),
    toolResult("m1", "fake", "task_check", "not classified"),
  ];

  assert.deepEqual([...collectLatestCheckpointEvidenceMessageIndexes(messages)], []);
  assert.deepEqual(collectScopedMessagesToSummarize(messages).messages, messages);
});

test("summary retention keeps the latest injection independently in every dialog", () => {
  const injected = (messageUid, dialogProcessId, content) =>
    injectedMessage(messageUid, "guidance", content, {
      dialogProcessId,
      turnScopeId: `turn-${dialogProcessId}`,
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
    selected.map((message) => readContextMessageField(message, "messageUid")),
    ["d1-old", "d2-old"],
  );
});

test("summary policy preserves latest task summary pair and latest injection", () => {
  const messages = [
    assistantCalls("m0", [flowCall("old", "summary_control", boundaryPolicy)]),
    flowResult("m1", "old", "summary_control", "old", boundaryPolicy),
    injectedMessage("m2", "guidance", "old guidance"),
    assistantCalls("m3", [flowCall("latest", "summary_control", boundaryPolicy)]),
    flowResult("m4", "latest", "summary_control", "latest", boundaryPolicy),
    injectedMessage("m5", "guidance", "latest guidance"),
  ];

  assert.deepEqual(currentTurnSummarizedFlags(messages), [true, true, true, false, false, false]);
});

test("checkpoint control prompts are summarized while normal injections retain their latest type", () => {
  const messages = [
    injectedMessage("m0", "guidance", "old"),
    injectedMessage("m1", "guidance", "latest"),
    msg("m2", {
      role: "user",
      content: "summary prompt",
      noobotInternalMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_PROMPT,
    }),
    msg("m3", {
      role: "user",
      content: "check prompt",
      noobotInternalMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.TASK_CHECK_PROMPT,
    }),
  ];

  assert.deepEqual(currentTurnSummarizedFlags(messages), [true, false, true, true]);
  assert.deepEqual(collectScopedMessagesToSummarize(messages).messages, [
    messages[0],
    messages[2],
    messages[3],
  ]);
});

test("summary checkpoint preserves only the latest task_check call and result pair", () => {
  const messages = [
    assistantCalls("m0", [flowCall("check-old", "check_control", evidencePolicy)]),
    flowResult("m1", "check-old", "check_control", "old", evidencePolicy),
    assistantCalls("m2", [{ id: "business", name: "execute_script" }]),
    toolResult("m3", "business", "execute_script", "ok"),
    assistantCalls("m4", [flowCall("check-latest", "check_control", evidencePolicy)]),
    flowResult("m5", "check-latest", "check_control", "latest", evidencePolicy),
    assistantCalls("m6", [flowCall("summary", "summary_control", boundaryPolicy)]),
    flowResult("m7", "summary", "summary_control", "summary", boundaryPolicy),
  ];

  assert.deepEqual(currentTurnSummarizedFlags(messages), [
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
  ]);
});

test("summary selection keeps a parallel tool-call batch atomic when task_check is preserved", () => {
  const messages = [
    assistantCalls("m0", [
      { id: "read-a", name: "read_file" },
      { id: "read-b", name: "read_file" },
      flowCall("check", "check_control", evidencePolicy),
    ]),
    toolResult("m1", "read-a", "read_file", "a"),
    toolResult("m2", "read-b", "read_file", "b"),
    flowResult("m3", "check", "check_control", "check", evidencePolicy),
  ];

  assert.deepEqual(collectScopedMessagesToSummarize(messages).messages, []);
  assert.deepEqual(currentTurnSummarizedFlags(messages), [false, false, false, false]);
});

test("summary selection does not select an incomplete parallel tool-call batch", () => {
  const messages = [
    assistantCalls("m0", [
      { id: "read-a", name: "read_file" },
      { id: "read-b", name: "read_file" },
    ]),
    toolResult("m1", "read-a", "read_file", "a"),
  ];

  assert.deepEqual(collectScopedMessagesToSummarize(messages).messages, []);
});

test("summary scope is the protocol-owned history plus incremental closed boundary", () => {
  const history = [
    msg("h1", { role: "user", content: "prior", dialogProcessId: "d1", turnScopeId: "t0" }),
  ];
  const call = msg("c1", {
    role: "assistant",
    dialogProcessId: "d1",
    turnScopeId: "t1",
    tool_calls: [{ id: "tool-1", name: "read_file" }],
  });
  const result = msg("r1", {
    role: "tool",
    dialogProcessId: "d1",
    turnScopeId: "t1",
    tool_call_id: "tool-1",
    content: "ok",
  });
  const scope = resolveSummaryScope({ history, incremental: [call, result] });
  assert.deepEqual(scope.sourceMessages, [history[0], call, result]);
  assert.deepEqual(scope.checkpointMessages, [history[0], call, result]);
  assert.deepEqual(scope.summaryMessages, [call, result]);
});

test("checkpoint targets use the completed authoritative scope to select one injection per type", () => {
  const oldGuidance = injectedMessage("old-guidance", "guidance", "old guidance");
  const latestGuidance = injectedMessage("latest-guidance", "guidance", "latest guidance");
  const oldSummary = injectedMessage("old-summary", "summary", "old summary");
  const completedSummary = injectedMessage("completed-summary", "summary", "completed summary");
  const checkpointTargets = [oldGuidance, latestGuidance, oldSummary];

  const result = markScopedMessagesSummarized(checkpointTargets, {
    retentionMessages: [...checkpointTargets, completedSummary],
  });

  assert.equal(result.changedCount, 2);
  assert.deepEqual(checkpointTargets.map(resolveContextMessageSummarized), [true, false, true]);
  assert.equal(resolveContextMessageSummarized(completedSummary), false);
});

test("summary policy marks restored guidance when a newer guidance exists", () => {
  const messages = [
    injectedMessage("restored-guidance", "separate_model_relay:guidance", "restored guidance", {
      injectedBy: "harness-plugin",
    }),
    injectedMessage("latest-guidance", "separate_model_relay:guidance", "latest guidance", {
      injectedBy: "harness-plugin",
    }),
  ];

  assert.deepEqual(currentTurnSummarizedFlags(messages), [true, false]);
});

test("user interjection is a retained injection category, not a checkpoint control", () => {
  const interjection = (messageUid, content) =>
    msg(messageUid, {
      role: "user",
      content,
      injectedMessage: true,
      injectedMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION,
      noobotInternalMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION,
    });
  const messages = [interjection("m0", "先记住这条"), interjection("m1", "再记住这条")];

  assert.equal(isContextControlMessage(messages[0]), false);
  assert.deepEqual(currentTurnSummarizedFlags(messages), [false, false]);
  assert.deepEqual(collectScopedMessagesToSummarize(messages).messages, []);
});
