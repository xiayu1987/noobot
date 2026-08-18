/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";

import {
  buildContextMessages,
  buildContextMessageBlocks,
} from "../../../src/context/assembly/message-builder.js";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";

const MAIN_MODEL_HISTORY_ROUND_LIMIT = TURN_THRESHOLDS.session.mainModelHistoryRoundLimit;
import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";
import { createPersistedCurrentUserMessage } from "./message-builder-current-user-fixture.js";
import {
  TASK_SUMMARY_PROTOCOL_VERSION,
  createTaskSummaryReceipt,
  parseTaskSummaryContent,
} from "@noobot/context-protocol/task/summary";

function buildRoundContents(fromRound, toRound) {
  return Array.from({ length: Math.max(0, toRound - fromRound + 1) }, (_, index) => {
    const number = fromRound + index;
    return [`u-${number}`, `a-${number}`];
  }).flat();
}

function buildDefaultHistoryRounds() {
  const totalRounds = MAIN_MODEL_HISTORY_ROUND_LIMIT + 2;
  return Array.from({ length: totalRounds }, (_, index) => [
    {
      role: "user",
      content: `u-${index + 1}`,
      dialogProcessId: `dlg-${index + 1}`,
    },
    {
      role: "assistant",
      content: `a-${index + 1}`,
      dialogProcessId: `dlg-${index + 1}`,
    },
  ]).flat();
}

function expectedDefaultHistoryContents() {
  const totalRounds = MAIN_MODEL_HISTORY_ROUND_LIMIT + 2;
  return buildRoundContents(totalRounds - MAIN_MODEL_HISTORY_ROUND_LIMIT + 1, totalRounds);
}

test("buildContextMessages drops orphan tool results without matching assistant tool_call", () => {
  const messages = buildContextMessages(
    createTestAgentExecutionScope(
      {},
      {
        messageBlocks: {
          system: [],
          history: [
            {
              role: "user",
              content: "q-1",
              dialogProcessId: "dlg-tool",
            },
            {
              role: "assistant",
              content: "",
              dialogProcessId: "dlg-tool",
              tool_calls: [
                {
                  id: "call_ok_1",
                  function: {
                    name: "task_summary",
                    arguments: "{}",
                  },
                },
              ],
            },
            {
              role: "tool",
              content: '{"ok":true}',
              tool_call_id: "call_ok_1",
              dialogProcessId: "dlg-tool",
            },
            {
              role: "tool",
              content: '{"ok":true}',
              tool_call_id: "call_orphan_1",
              dialogProcessId: "dlg-tool",
            },
            {
              role: "assistant",
              content: "final",
              dialogProcessId: "dlg-tool",
            },
          ],
        },
      },
    ),
    { currentUserMessage: null },
  );

  const toolMessages = messages.filter((item) => item instanceof ToolMessage);
  assert.equal(toolMessages.length, 1);
  assert.equal(toolMessages[0].tool_call_id, "call_ok_1");
});

test("buildContextMessages converts orphan task_summary tool result to user summary message", () => {
  const summaryContent = [
    "NOOBOT_TASK_SUMMARY/1",
    "[STATE]",
    "CONTINUE",
    "[ABSTRACT]",
    "孤立小结内容",
    "[DETAILS]",
    "孤立工具结果中的权威阶段小结",
    "[NEXT_ACTION]",
    "继续执行",
  ].join("\n");
  const summary = createTaskSummaryReceipt(parseTaskSummaryContent(summaryContent));
  const messages = buildContextMessages(
    createTestAgentExecutionScope(
      {},
      {
        messageBlocks: {
          system: [],
          history: [
            {
              role: "user",
              content: "q-summary",
              dialogProcessId: "dlg-summary",
            },
            {
              role: "tool",
              content: JSON.stringify({
                toolName: "task_summary",
                ok: true,
                protocolVersion: TASK_SUMMARY_PROTOCOL_VERSION,
                summary,
              }),
              tool_call_id: "call_orphan_summary",
              dialogProcessId: "dlg-summary",
              turnScopeId: "turn-summary",
            },
            {
              role: "assistant",
              content: "done",
              dialogProcessId: "dlg-summary",
            },
          ],
        },
      },
    ),
    { currentUserMessage: null },
  );

  assert.equal(
    messages.some((item) => item instanceof ToolMessage),
    false,
  );
  const humanMessage = messages.find(
    (item) =>
      item instanceof HumanMessage &&
      item.additional_kwargs?.noobotInternalMessageType === "phase_summary_memory",
  );
  assert.ok(humanMessage);
  assert.equal(String(humanMessage.content || "").includes("孤立小结内容"), true);
});
