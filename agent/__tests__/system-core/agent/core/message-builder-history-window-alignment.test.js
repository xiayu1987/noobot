/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

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

test("buildContextMessages keeps explicit history dialog groups in natural order", () => {
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {
            systemRuntime: {
              dialogProcessId: "dlg_current",
            },
          },
        },
      },
      payload: {
        messages: {
          system: [],
          history: [
            {
              role: "user",
              content: "当前问题",
              dialogProcessId: "dlg_newer",
            },
            {
              role: "assistant",
              content: "当前对话注入",
              injectedMessage: true,
              injectedBy: "agent-plugin",
              dialogProcessId: "dlg_newer",
            },
            {
              role: "assistant",
              content: "旧对话注入",
              injectedMessage: true,
              injectedBy: "agent-plugin",
              dialogProcessId: "dlg_old",
            },
          ],
        },
      },
    },
    { currentUserMessage: "" },
  );

  assert.equal(messages.some((item) => item?.content === "当前对话注入"), true);
  assert.equal(messages.some((item) => item?.content === "旧对话注入"), true);
});

test("buildContextMessages applies main model recent round window by default", () => {
  const history = buildDefaultHistoryRounds();
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
          history,
        },
      },
    },
    { currentUserMessage: "" },
  );

  assert.deepEqual(
    messages
      .filter((item) => item?.additional_kwargs?.noobotInternalMessageType !== "user_meta")
      .map((item) => item?.content),
    expectedDefaultHistoryContents(),
  );
});

test("buildContextMessages keeps harness plugin history aligned with main recent rounds", () => {
  const history = buildDefaultHistoryRounds();
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {
            globalConfig: {
              plugins: {
                harness: {
                  enabled: true,
                  mode: "on",
                },
              },
            },
          },
        },
      },
      payload: {
        messages: {
          system: [],
          history,
        },
      },
    },
    { currentUserMessage: "" },
  );

  assert.deepEqual(
    messages
      .filter((item) => item?.additional_kwargs?.noobotInternalMessageType !== "user_meta")
      .map((item) => item?.content),
    expectedDefaultHistoryContents(),
  );
});
