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
} from "../../../../src/system-core/agent/core/context/message-builder.js";
import { MAIN_MODEL_HISTORY_ROUND_LIMIT } from "../../../../src/system-core/session/utils/context-window-normalizer.js";

function buildRoundContents(fromRound, toRound) {
  return Array.from(
    { length: Math.max(0, toRound - fromRound + 1) },
    (_, index) => {
      const number = fromRound + index;
      return [`u-${number}`, `a-${number}`];
    },
  ).flat();
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
    {
      execution: {
        controllers: {
          runtime: {},
        },
      },
      payload: {
        messages: {
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
              content: "{\"ok\":true}",
              tool_call_id: "call_ok_1",
              dialogProcessId: "dlg-tool",
            },
            {
              role: "tool",
              content: "{\"ok\":true}",
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
    },
    { currentUserMessage: "" },
  );

  const toolMessages = messages.filter((item) => item instanceof ToolMessage);
  assert.equal(toolMessages.length, 1);
  assert.equal(toolMessages[0].tool_call_id, "call_ok_1");
});

test("buildContextMessages converts orphan task_summary tool result to user summary message", () => {
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {},
        },
      },
      payload: {
        messages: {
          system: [],
          history: [
            {
              role: "user",
              content: "q-summary",
              dialogProcessId: "dlg-summary",
            },
            {
              role: "tool",
              content: "{\"toolName\":\"task_summary\",\"ok\":true,\"phaseSummary\":\"孤立小结内容\"}",
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
    },
    { currentUserMessage: "" },
  );

  assert.equal(messages.some((item) => item instanceof ToolMessage), false);
  const humanMessage = messages.find(
    (item) => item instanceof HumanMessage && String(item.content || "").includes("[阶段小结]"),
  );
  assert.ok(humanMessage);
  assert.equal(String(humanMessage.content || "").includes("[阶段小结]"), true);
  assert.equal(String(humanMessage.content || "").includes("孤立小结内容"), true);
});
