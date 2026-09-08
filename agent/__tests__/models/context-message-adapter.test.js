/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildHistoryMessages } from "../../src/context/assembly/message-builder/history.js";
import { toLangChainToolCalls } from "../../src/models/adapters/langchain/context-message-adapter.js";
import {
  collectDialogScopedMessagesToSummarize,
  collectLatestCheckpointEvidenceMessageIndexes,
} from "@noobot/context-protocol/policy/summary";
import {
  FLOW_CONTROL_ROLE,
  createFlowControlContextPolicy,
  resolveToolContextPolicy,
} from "@noobot/context-protocol/tool/context-policy";

const checkpointEvidencePolicy = createFlowControlContextPolicy(
  FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE,
);

test("toLangChainToolCalls preserves canonical context policy for both tool-call shapes", () => {
  const calls = toLangChainToolCalls([
    {
      id: "direct",
      name: "task_check",
      args: { ok: true },
      contextPolicy: checkpointEvidencePolicy,
    },
    {
      id: "openai",
      function: { name: "task_check", arguments: '{"ok":true}' },
      contextPolicy: checkpointEvidencePolicy,
    },
  ]);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].contextPolicy, checkpointEvidencePolicy);
  assert.deepEqual(calls[1].contextPolicy, checkpointEvidencePolicy);
});

test("restored task_check history remains checkpoint evidence after LangChain projection", () => {
  const history = buildHistoryMessages({
    effectiveHistoryMessages: [
      {
        role: "assistant",
        content: "",
        messageUid: "sm_task_check_call",
        tool_calls: [
          {
            id: "task-check-1",
            function: { name: "task_check", arguments: '{"scope":"current"}' },
            contextPolicy: checkpointEvidencePolicy,
          },
        ],
      },
      {
        role: "tool",
        content: '{"ok":true}',
        messageUid: "sm_task_check_result",
        tool_call_id: "task-check-1",
      },
    ],
  });

  assert.deepEqual(collectLatestCheckpointEvidenceMessageIndexes(history), new Set([0, 1]));
});

test("restored checkpoint tool results retain policy in history and close summary batches", () => {
  const boundaryPolicy = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_BOUNDARY);
  const evidencePolicy = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE);
  const dialogProcessId = "dialog-1";
  const source = [
    { role: "user", content: "start", messageUid: "user-1", dialogProcessId },
    {
      role: "assistant",
      content: "",
      messageUid: "summary-call",
      dialogProcessId,
      tool_calls: [
        {
          id: "summary-1",
          name: "task_summary",
          args: {},
          contextPolicy: boundaryPolicy,
        },
      ],
    },
    {
      role: "tool",
      content: "summary persisted",
      messageUid: "summary-result",
      dialogProcessId,
      tool_call_id: "summary-1",
    },
    {
      role: "assistant",
      content: "",
      messageUid: "check-call",
      dialogProcessId,
      tool_calls: [
        {
          id: "check-1",
          name: "task_check",
          args: {},
          contextPolicy: evidencePolicy,
        },
      ],
    },
    {
      role: "tool",
      content: "check persisted",
      messageUid: "check-result",
      dialogProcessId,
      tool_call_id: "check-1",
    },
    { role: "assistant", content: "done", messageUid: "assistant-final", dialogProcessId },
  ];

  const history = buildHistoryMessages({ effectiveHistoryMessages: source });
  assert.deepEqual(resolveToolContextPolicy(history[2]), boundaryPolicy);
  assert.deepEqual(resolveToolContextPolicy(history[4]), evidencePolicy);
  assert.deepEqual(
    collectDialogScopedMessagesToSummarize(history, {
      maxMessages: history.length,
      limitToProvidedMessagesOnly: true,
      retentionMessages: history,
    }),
    [],
  );
});
