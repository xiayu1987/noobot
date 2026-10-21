/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalMessageBlocks } from "../src/policy/block.js";

function ctx(role, content, metadata = {}) {
  return { role, content, additional_kwargs: { ...metadata } };
}

function record(role, content, facts = {}) {
  return { role, content, ...facts };
}

const HISTORY_ROUND = { dialogProcessId: "history-dialog", turnScopeId: "history-turn" };
const SNAPSHOT_ROUND = { dialogProcessId: "snapshot-dialog", turnScopeId: "snapshot-turn" };

test("canonical blocks preserve main system history incremental composition", () => {
  const result = buildCanonicalMessageBlocks({
    systemMessages: [ctx("system", "system", { messageUid: "sm_system" })],
    historyMessages: [
      ctx("user", "history", { messageUid: "sm_history", ...HISTORY_ROUND }),
      ctx("assistant", "history-answer", { messageUid: "sm_answer", ...HISTORY_ROUND }),
    ],
    incrementalMessages: [],
    currentUserMessage: record("user", "current", {
      messageUid: "sm_current",
      dialogProcessId: "current-dialog",
      turnScopeId: "current-turn",
    }),
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

test("history rounds group by each message's own dialog identity", () => {
  const result = buildCanonicalMessageBlocks({
    historyMessages: [
      ctx("user", "task", { messageUid: "sm_task", ...SNAPSHOT_ROUND }),
      ctx("assistant", "tool call", { messageUid: "sm_call", ...SNAPSHOT_ROUND }),
      ctx("tool", "tool result", { messageUid: "sm_result", ...SNAPSHOT_ROUND }),
    ],
  });

  assert.deepEqual(
    result.history.map((message) => message.content),
    ["task", "tool call", "tool result"],
  );
});

test("current history exclusion uses explicit runtime identity instead of fallback identity", () => {
  const result = buildCanonicalMessageBlocks({
    historyMessages: [
      ctx("user", "snapshot", { messageUid: "sm_snapshot", ...SNAPSHOT_ROUND }),
      ctx("assistant", "answer", { messageUid: "sm_snapshot_answer", ...SNAPSHOT_ROUND }),
    ],
    currentUserMessage: record("user", "continue", {
      messageUid: "sm_continue",
      dialogProcessId: "snapshot-dialog",
      turnScopeId: "current-turn",
    }),
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
    () => buildCanonicalMessageBlocks({ currentUserMessage: record("user", "current") }),
    /requires messageUid/,
  );
  assert.throws(
    () =>
      buildCanonicalMessageBlocks({
        currentUserMessage: record("user", "", { messageUid: "sm_current" }),
      }),
    /requires persisted content/,
  );
  assert.throws(
    () =>
      buildCanonicalMessageBlocks({
        currentUserMessage: record("user", "current", {
          messageUid: "sm_current",
          dialogProcessId: "dialog-current",
        }),
      }),
    /canonical user round identity/,
  );
});
