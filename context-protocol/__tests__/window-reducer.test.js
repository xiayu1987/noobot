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
import { withContextMessageMetadata } from "../src/message/codec.js";

function ctx(role, content, metadata = {}) {
  return { role, content, additional_kwargs: { ...metadata } };
}

let roundUserSequence = 0;

function roundUser(content, dialogProcessId, turnScopeId, metadata = {}) {
  roundUserSequence += 1;
  return ctx("user", content, {
    messageUid: `sm_round_user_${roundUserSequence}`,
    ...(dialogProcessId ? { dialogProcessId } : {}),
    ...(turnScopeId ? { turnScopeId } : {}),
    ...metadata,
  });
}

const HARNESS_GUIDANCE = Object.freeze({
  injectedMessage: true,
  injectedBy: "harness-plugin",
  injectedMessageType: "guidance",
});

test("incremental replaces history when both projections carry the same canonical identity", () => {
  const historyUser = roundUser("same text", "dialog-current", "turn-current", {
    messageUid: "sm_current",
  });
  const incrementalUser = roundUser("same text", "dialog-current", "turn-current", {
    messageUid: "sm_current",
  });
  const result = resolveModelFinalMessages({
    historyMessages: [historyUser],
    incrementalMessages: [incrementalUser],
  });

  assert.deepEqual(result.history, []);
  assert.deepEqual(result.incremental, [incrementalUser]);
  assert.deepEqual(result.messages, [incrementalUser]);
});

test("final projection preserves unsummarized injections in history and incremental", () => {
  const injected = (id, dialogProcessId, content) =>
    roundUser(content, dialogProcessId, `turn-${dialogProcessId}`, {
      messageUid: id,
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

test("history rejects messages without their own dialog identity", () => {
  assert.throws(
    () => resolveModelHistoryMessages({ sourceMessages: [ctx("user", "missing-dialog")] }),
    /requires additional_kwargs\.dialogProcessId/,
  );
});

test("history filters system and summarized messages before selecting recent dialog groups", () => {
  const input = [
    ctx("user", "d1", { dialogProcessId: "d1" }),
    ctx("user", "d2", { dialogProcessId: "d2" }),
    ctx("user", "d3-summarized", { dialogProcessId: "d3", summarized: true }),
    ctx("system", "d3-system", { dialogProcessId: "d3" }),
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
    ctx("user", "d2-first", { dialogProcessId: "d2" }),
    ctx("user", "d1", { dialogProcessId: "d1" }),
    ctx("assistant", "d2-late", { dialogProcessId: "d2" }),
  ];

  assert.deepEqual(
    resolveModelHistoryMessages({ sourceMessages: input, historyLimit: 1 }).map(
      (message) => message.content,
    ),
    ["d1"],
  );
});

test("history only consumes summary marks after each dialog retains its own latest injection", () => {
  const message = (id, dialogProcessId, content, { role = "user", ...metadata } = {}) =>
    ctx(role, content, {
      messageUid: id,
      dialogProcessId,
      turnScopeId: `turn-${dialogProcessId}`,
      ...metadata,
    });
  const source = [
    message("d1-user", "d1", "d1 user"),
    message("d1-guidance-old", "d1", "d1 old guidance", HARNESS_GUIDANCE),
    message("d1-guidance-latest", "d1", "d1 latest guidance", HARNESS_GUIDANCE),
    message("d1-answer", "d1", "d1 answer", { role: "assistant" }),
    message("d2-user", "d2", "d2 user"),
    message("d2-guidance-old", "d2", "d2 old guidance", HARNESS_GUIDANCE),
    message("d2-guidance-latest", "d2", "d2 latest guidance", HARNESS_GUIDANCE),
    message("d2-answer", "d2", "d2 answer", { role: "assistant" }),
  ];

  const selected = new Set(collectDialogScopedMessagesToSummarize(source));
  const persisted = source.map((item) =>
    selected.has(item) ? withContextMessageMetadata(item, { summarized: true }) : item,
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
  const historyUser = roundUser("same text", "dialog-current", "turn-current", {
    messageUid: "sm_current",
  });
  const incrementalUser = roundUser("same text", "dialog-current", "turn-current", {
    messageOrigin: "natural",
    messageUid: "sm_current",
  });
  const context = createModelContext({
    messageBlocks: {
      system: [],
      history: [historyUser],
      incremental: [incrementalUser],
    },
  });

  assert.equal(context.messageBlocks.history[0], context.messageBlocks.incremental[0]);
  assert.equal(context.messages.includes(context.messageBlocks.history[0]), true);
});

test("same text in different dialog processes remains distinct", () => {
  const historyUser = roundUser("same text", "dialog-old", "turn-current");
  const incrementalUser = roundUser("same text", "dialog-current", "turn-current");
  const result = resolveModelFinalMessages({
    historyMessages: [historyUser],
    incrementalMessages: [incrementalUser],
  });

  assert.deepEqual(result.messages, [historyUser, incrementalUser]);
});

test("same text in different turns remains distinct", () => {
  const historyUser = roundUser("same text", "dialog-current", "turn-old");
  const incrementalUser = roundUser("same text", "dialog-current", "turn-current");
  const result = resolveModelFinalMessages({
    historyMessages: [historyUser],
    incrementalMessages: [incrementalUser],
  });

  assert.deepEqual(result.messages, [historyUser, incrementalUser]);
});

test("messages without context identity are rejected", () => {
  const historyUser = ctx("user", "same text", { dialogProcessId: "dialog-current" });
  assert.throws(
    () => resolveModelFinalMessages({ historyMessages: [], incrementalMessages: [historyUser] }),
    /context message identity must be exactly one shape, got: none/,
  );
});

test("distinct canonical message ids are never content-deduplicated", () => {
  const historyUser = roundUser("same text", "dialog-current", "turn-current", {
    messageUid: "sm_history",
  });
  const incrementalUser = roundUser("same text", "dialog-current", "turn-current", {
    messageUid: "sm_incremental",
  });
  const result = resolveModelFinalMessages({
    historyMessages: [historyUser],
    incrementalMessages: [incrementalUser],
  });

  assert.deepEqual(result.messages, [historyUser, incrementalUser]);
});
