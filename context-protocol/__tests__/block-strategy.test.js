/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalMessageBlocks } from "../src/policy/block-strategy.js";

test("canonical blocks preserve main system history incremental composition", () => {
  const result = buildCanonicalMessageBlocks({
    systemMessages: [{ role: "system", content: "system" }],
    historyMessages: [
      {
        role: "user",
        content: "history",
        dialogProcessId: "history-dialog",
        turnScopeId: "history-turn",
      },
      { role: "assistant", content: "history-answer" },
    ],
    incrementalMessages: [],
    currentUserMessage: {
      messageUid: "sm_current",
      role: "user",
      content: "current",
      dialogProcessId: "current-dialog",
      turnScopeId: "current-turn",
    },
    historyExclusionIdentity: { dialogProcessId: "current-dialog", turnScopeId: "current-turn" },
  });

  assert.deepEqual(
    result.system.map((message) => message.content),
    ["system"],
  );
  assert.deepEqual(
    result.history.map((message) => message.content),
    ["history", "history-answer"],
  );
  assert.deepEqual(
    result.incremental.map((message) => message.content),
    ["current"],
  );
  assert.deepEqual(result.messages, [...result.system, ...result.history, ...result.incremental]);
});

test("snapshot history inherits round identity for grouping without mutating messages", () => {
  const assistant = { role: "assistant", content: "tool call" };
  const tool = { role: "tool", content: "tool result" };
  const result = buildCanonicalMessageBlocks({
    historyMessages: [
      {
        role: "user",
        content: "task",
        dialogProcessId: "snapshot-dialog",
        turnScopeId: "snapshot-turn",
      },
      assistant,
      tool,
    ],
  });

  assert.deepEqual(
    result.history.map((message) => message.content),
    ["task", "tool call", "tool result"],
  );
  assert.equal(assistant.dialogProcessId, undefined);
  assert.equal(tool.dialogProcessId, undefined);
});

test("current history exclusion uses explicit runtime identity instead of fallback identity", () => {
  const result = buildCanonicalMessageBlocks({
    historyMessages: [
      {
        role: "user",
        content: "snapshot",
        dialogProcessId: "snapshot-dialog",
        turnScopeId: "snapshot-turn",
      },
      { role: "assistant", content: "answer" },
    ],
    currentUserMessage: {
      messageUid: "sm_continue",
      role: "user",
      content: "continue",
      dialogProcessId: "snapshot-dialog",
      turnScopeId: "current-turn",
    },
    historyExclusionIdentity: { dialogProcessId: "current-dialog", turnScopeId: "current-turn" },
  });

  assert.deepEqual(
    result.history.map((message) => message.content),
    ["snapshot", "answer"],
  );
  assert.deepEqual(
    result.incremental.map((message) => message.content),
    ["continue"],
  );
});

test("current message protocol rejects text without persisted identity", () => {
  assert.throws(
    () => buildCanonicalMessageBlocks({ currentUserMessage: "current" }),
    /canonical persisted message entity/,
  );
  assert.throws(
    () => buildCanonicalMessageBlocks({ currentUserMessage: { role: "user", content: "current" } }),
    /persisted content and messageUid/,
  );
  assert.throws(
    () =>
      buildCanonicalMessageBlocks({
        currentUserMessage: {
          messageUid: "sm_current",
          role: "user",
          content: "current",
          dialogProcessId: "dialog-current",
        },
      }),
    /canonical user round identity/,
  );
});
