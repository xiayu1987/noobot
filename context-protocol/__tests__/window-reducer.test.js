/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createModelContext } from "../src/assembly/hook-context.js";
import { resolveModelFinalMessages, resolveModelHistoryMessages } from "../src/policy/window.js";
import { collectDialogScopedMessagesToSummarize } from "../src/policy/summary.js";

function legacyUser(content, dialogProcessId, turnScopeId) {
  return {
    role: "user",
    content,
    ...(dialogProcessId ? { dialogProcessId } : {}),
    additional_kwargs: turnScopeId ? { turnScopeId } : {},
  };
}

test("incremental replaces history when both projections carry the same canonical identity", () => {
  const historyUser = {
    ...legacyUser("same text", "dialog-current", "turn-current"),
    additional_kwargs: { turnScopeId: "turn-current", noobotMessageId: "am_current" },
  };
  const incrementalUser = {
    ...legacyUser("same text", "dialog-current", "turn-current"),
    additional_kwargs: { turnScopeId: "turn-current", noobotMessageId: "am_current" },
  };
  const result = resolveModelFinalMessages({
    historyMessages: [historyUser],
    incrementalMessages: [incrementalUser],
  });

  assert.deepEqual(result.history, []);
  assert.deepEqual(result.incremental, [incrementalUser]);
  assert.deepEqual(result.messages, [incrementalUser]);
});

test("final projection preserves unsummarized injections in history and incremental", () => {
  const injected = (id, dialogProcessId, content) => ({
    role: "user",
    content,
    dialogProcessId,
    turnScopeId: `turn-${dialogProcessId}`,
    additional_kwargs: { noobotMessageId: id },
    injectedMessage: true,
    injectedBy: "harness-plugin",
    injectedMessageType: "separate_model_relay:guidance",
  });
  const historyOld = injected("history-old", "history-dialog", "history old guidance");
  const historyLatest = injected("history-latest", "history-dialog", "history latest guidance");
  const incrementalOld = injected("incremental-old", "current-dialog", "incremental old guidance");
  const incrementalLatest = injected(
    "incremental-latest",
    "current-dialog",
    "incremental latest guidance",
  );

  const result = resolveModelFinalMessages({
    historyMessages: [historyOld, historyLatest],
    incrementalMessages: [incrementalOld, incrementalLatest],
  });

  assert.deepEqual(result.history, [historyOld, historyLatest]);
  assert.deepEqual(result.incremental, [incrementalOld, incrementalLatest]);
  assert.deepEqual(result.messages, [historyOld, historyLatest, incrementalOld, incrementalLatest]);
});

test("history filters missing identity, system and summarized messages before selecting recent dialog groups", () => {
  const input = [
    { role: "user", content: "missing-dialog" },
    { role: "user", content: "d1", dialogProcessId: "d1" },
    { role: "user", content: "d2", dialogProcessId: "d2" },
    { role: "user", content: "d3-summarized", dialogProcessId: "d3", summarized: true },
    { role: "system", content: "d3-system", dialogProcessId: "d3" },
  ];

  assert.deepEqual(
    resolveModelHistoryMessages({ sourceMessages: input, historyLimit: 2 }).map(
      (message) => message.content,
    ),
    ["d1", "d2"],
  );
});

test("history group order comes only from first occurrence in filtered messages", () => {
  const input = [
    { role: "user", content: "d2-first", dialogProcessId: "d2" },
    { role: "user", content: "d1", dialogProcessId: "d1" },
    { role: "assistant", content: "d2-late", dialogProcessId: "d2" },
  ];

  assert.deepEqual(
    resolveModelHistoryMessages({ sourceMessages: input, historyLimit: 1 }).map(
      (message) => message.content,
    ),
    ["d1"],
  );
});

test("history only consumes summary marks after each dialog retains its own latest injection", () => {
  const message = (id, dialogProcessId, content, extra = {}) => ({
    role: "user",
    content,
    dialogProcessId,
    turnScopeId: `turn-${dialogProcessId}`,
    additional_kwargs: { noobotMessageId: id },
    ...extra,
  });
  const source = [
    message("d1-user", "d1", "d1 user"),
    message("d1-guidance-old", "d1", "d1 old guidance", {
      injectedMessage: true,
      injectedBy: "harness-plugin",
      injectedMessageType: "guidance",
    }),
    message("d1-guidance-latest", "d1", "d1 latest guidance", {
      injectedMessage: true,
      injectedBy: "harness-plugin",
      injectedMessageType: "guidance",
    }),
    message("d1-answer", "d1", "d1 answer", { role: "assistant" }),
    message("d2-user", "d2", "d2 user"),
    message("d2-guidance-old", "d2", "d2 old guidance", {
      injectedMessage: true,
      injectedBy: "harness-plugin",
      injectedMessageType: "guidance",
    }),
    message("d2-guidance-latest", "d2", "d2 latest guidance", {
      injectedMessage: true,
      injectedBy: "harness-plugin",
      injectedMessageType: "guidance",
    }),
    message("d2-answer", "d2", "d2 answer", { role: "assistant" }),
  ];

  const selected = new Set(collectDialogScopedMessagesToSummarize(source));
  const persisted = source.map((item) =>
    selected.has(item) ? { ...item, summarized: true } : item,
  );

  assert.deepEqual(
    [...selected].map((item) => item.content),
    ["d1 old guidance", "d2 old guidance"],
  );
  assert.deepEqual(
    resolveModelHistoryMessages({ sourceMessages: persisted, historyLimit: 5 }).map(
      (item) => item.content,
    ),
    ["d1 user", "d1 latest guidance", "d1 answer", "d2 user", "d2 latest guidance", "d2 answer"],
  );
});

test("explicit blocks hydrate one stable identity for projections with the same canonical id", () => {
  const historyUser = {
    ...legacyUser("same text", "dialog-current", "turn-current"),
    additional_kwargs: { turnScopeId: "turn-current", noobotMessageId: "am_current" },
  };
  const incrementalUser = {
    ...legacyUser("same text", "dialog-current", "turn-current"),
    additional_kwargs: {
      turnScopeId: "turn-current",
      messageOrigin: "natural",
      userMetaMaterialized: true,
      noobotMessageId: "am_current",
    },
  };
  const context = createModelContext({
    messages: [{ role: "assistant", content: "stale-flat-message" }],
    messageBlocks: {
      system: [],
      history: [historyUser],
      incremental: [incrementalUser],
    },
  });

  assert.equal(context.messageBlocks.history[0], context.messageBlocks.incremental[0]);
  assert.equal(context.messages.includes(context.messageBlocks.history[0]), true);
  assert.equal(
    context.messages.some((message) => message.content === "stale-flat-message"),
    false,
  );
});

test("same text in different dialog processes remains distinct", () => {
  const historyUser = legacyUser("same text", "dialog-old", "turn-current");
  const incrementalUser = legacyUser("same text", "dialog-current", "turn-current");
  const result = resolveModelFinalMessages({
    historyMessages: [historyUser],
    incrementalMessages: [incrementalUser],
  });

  assert.deepEqual(result.messages, [historyUser, incrementalUser]);
});

test("same text in different turns remains distinct", () => {
  const historyUser = legacyUser("same text", "dialog-current", "turn-old");
  const incrementalUser = legacyUser("same text", "dialog-current", "turn-current");
  const result = resolveModelFinalMessages({
    historyMessages: [historyUser],
    incrementalMessages: [incrementalUser],
  });

  assert.deepEqual(result.messages, [historyUser, incrementalUser]);
});

test("messages without canonical ids are distinct protocol entities", () => {
  const historyUser = legacyUser("same text", "dialog-current", "");
  const incrementalUser = legacyUser("same text", "dialog-current", "");
  const result = resolveModelFinalMessages({
    historyMessages: [historyUser],
    incrementalMessages: [incrementalUser],
  });

  assert.deepEqual(result.messages, [historyUser, incrementalUser]);
});

test("distinct canonical message ids are never content-deduplicated", () => {
  const historyUser = {
    ...legacyUser("same text", "dialog-current", "turn-current"),
    additional_kwargs: { turnScopeId: "turn-current", noobotMessageId: "am_history" },
  };
  const incrementalUser = {
    ...legacyUser("same text", "dialog-current", "turn-current"),
    additional_kwargs: { turnScopeId: "turn-current", noobotMessageId: "am_incremental" },
  };
  const result = resolveModelFinalMessages({
    historyMessages: [historyUser],
    incrementalMessages: [incrementalUser],
  });

  assert.deepEqual(result.messages, [historyUser, incrementalUser]);
});
