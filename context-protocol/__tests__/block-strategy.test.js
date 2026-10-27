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
const EMPTY_BLOCKS = { systemMessages: [], historyMessages: [], incrementalMessages: [] };
const HISTORY_LIMIT = Number.POSITIVE_INFINITY;

function currentRecord(content = "current", facts = {}) {
  return record("user", content, {
    messageUid: "sm_current",
    dialogProcessId: "current-dialog",
    turnScopeId: "current-turn",
    ...facts,
  });
}

test("canonical blocks preserve main system history incremental composition", () => {
  const result = buildCanonicalMessageBlocks({
    systemMessages: [ctx("system", "system", { messageUid: "sm_system" })],
    historyMessages: [
      ctx("user", "history", { messageUid: "sm_history", ...HISTORY_ROUND }),
      ctx("assistant", "history-answer", { messageUid: "sm_answer", ...HISTORY_ROUND }),
    ],
    incrementalMessages: [],
    currentUserMessage: currentRecord(),
    historyLimit: HISTORY_LIMIT,
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
    ...EMPTY_BLOCKS,
    historyMessages: [
      ctx("user", "task", { messageUid: "sm_task", ...SNAPSHOT_ROUND }),
      ctx("assistant", "tool call", { messageUid: "sm_call", ...SNAPSHOT_ROUND }),
      ctx("tool", "tool result", { messageUid: "sm_result", ...SNAPSHOT_ROUND }),
    ],
    currentUserMessage: currentRecord(),
    historyLimit: HISTORY_LIMIT,
  });

  assert.deepEqual(
    result.history.map((message) => message.content),
    ["task", "tool call", "tool result"],
  );
});

test("current history exclusion uses the current message round identity", () => {
  const result = buildCanonicalMessageBlocks({
    ...EMPTY_BLOCKS,
    historyMessages: [
      ctx("user", "history", { messageUid: "sm_history", ...HISTORY_ROUND }),
      ctx("user", "current earlier copy", {
        messageUid: "sm_current_copy",
        dialogProcessId: "current-dialog",
        turnScopeId: "current-turn",
      }),
      ctx("assistant", "current partial", {
        messageUid: "sm_partial",
        dialogProcessId: "current-dialog",
        turnScopeId: "current-turn",
      }),
    ],
    currentUserMessage: currentRecord("continue"),
    historyLimit: HISTORY_LIMIT,
  });

  assert.deepEqual(
    result.history.map((message) => message.content),
    ["history"],
  );
  assert.deepEqual(
    result.incremental.map((message) => message.content),
    ["continue"],
  );
});

test("current message protocol rejects text without persisted identity", () => {
  assert.throws(
    () => buildCanonicalMessageBlocks({ ...EMPTY_BLOCKS, currentUserMessage: null }),
    /canonical persisted message entity/,
  );
  assert.throws(
    () => buildCanonicalMessageBlocks({ ...EMPTY_BLOCKS, currentUserMessage: "current" }),
    /canonical persisted message entity/,
  );
  assert.throws(
    () =>
      buildCanonicalMessageBlocks({
        ...EMPTY_BLOCKS,
        currentUserMessage: record("user", "current"),
      }),
    /requires messageUid/,
  );
  assert.throws(
    () =>
      buildCanonicalMessageBlocks({
        ...EMPTY_BLOCKS,
        currentUserMessage: record("user", "", { messageUid: "sm_current" }),
      }),
    /requires persisted content/,
  );
  assert.throws(
    () =>
      buildCanonicalMessageBlocks({
        ...EMPTY_BLOCKS,
        currentUserMessage: record("user", "current", {
          messageUid: "sm_current",
          dialogProcessId: "dialog-current",
        }),
      }),
    /canonical user round identity/,
  );
});
