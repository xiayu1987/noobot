/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createModelContextSnapshot,
  hydrateModelContextSnapshot,
  projectRecoveredMessagesToIdentity,
} from "../src/snapshot-policy.js";
import { createModelContext } from "../src/hook-context.js";
import { appendMessage } from "../src/message-store.js";

const identity = {
  userId: "admin",
  sessionId: "session",
  parentSessionId: "",
  dialogProcessId: "dialog",
  turnScopeId: "turn",
};

test("snapshot policy preserves block boundaries and message protocol fields", () => {
  const snapshot = createModelContextSnapshot({
    identity,
    now: "2026-08-03T00:00:00.000Z",
    messageBlocks: {
      system: [{ role: "system", content: "system" }],
      history: [{ role: "assistant", content: "", tool_calls: [{ id: "call", name: "tool" }], custom: { value: 1 } }],
      incremental: [{ role: "tool", content: "result", tool_call_id: "call", summarized: true }],
    },
  });
  const hydrated = hydrateModelContextSnapshot(snapshot, identity);

  assert.equal(snapshot.version, 2);
  assert.deepEqual(hydrated.messageBlocks.history[0].tool_calls, [{ id: "call", name: "tool" }]);
  assert.deepEqual(hydrated.messageBlocks.history[0].custom, { value: 1 });
  assert.equal(hydrated.messageBlocks.incremental[0].tool_call_id, "call");
  assert.equal(hydrated.messageBlocks.incremental[0].summarized, true);
  assert.equal(hydrated.messages.length, 3);
});

test("snapshot recovery atomically rebinds every message to the current round identity", () => {
  const [message] = projectRecoveredMessagesToIdentity([
    { role: "user", sessionId: "old", dialogProcessId: "history-dialog", turnScopeId: "history-turn" },
  ], {
    userName: "admin",
    sessionId: "current",
    dialogProcessId: "current-dialog",
    turnScopeId: "current-turn",
  });

  assert.equal(message.sessionId, "current");
  assert.equal(message.dialogProcessId, "current-dialog");
  assert.equal(message.turnScopeId, "current-turn");
});

test("snapshot recovery replaces a partial historical identity with the complete current pair", () => {
  const [message] = projectRecoveredMessagesToIdentity([
    { role: "tool", content: "result", dialogProcessId: "dialog-only" },
  ], {
    dialogProcessId: "current-dialog",
    turnScopeId: "current-turn",
  });
  assert.equal(message.dialogProcessId, "current-dialog");
  assert.equal(message.turnScopeId, "current-turn");
});

test("snapshot recovery removes nested stale identity and rewrites structured user metadata", () => {
  const [message] = projectRecoveredMessagesToIdentity([{
    role: "user",
    content: `[用户元信息]\n${JSON.stringify({
      sessionId: "old-session",
      dialogProcessId: "old-dialog",
      turnScopeId: "old-turn",
      attachments: [{ attachmentId: "attachment-1" }],
    }, null, 2)}\n[/用户元信息]`,
    additional_kwargs: {
      noobotInternalMessageType: "user_meta",
      dialogProcessId: "old-dialog",
      turnScopeId: "old-turn",
    },
    lc_kwargs: {
      additional_kwargs: {
        dialogProcessId: "old-dialog",
        turnScopeId: "old-turn",
      },
    },
  }], {
    userName: "admin",
    sessionId: "current-session",
    dialogProcessId: "current-dialog",
    turnScopeId: "current-turn",
  });

  const embedded = JSON.parse(message.content.slice(
    message.content.indexOf("{"),
    message.content.lastIndexOf("}") + 1,
  ));
  assert.equal(message.dialogProcessId, "current-dialog");
  assert.equal(message.turnScopeId, "current-turn");
  assert.equal(message.additional_kwargs.dialogProcessId, undefined);
  assert.equal(message.additional_kwargs.turnScopeId, undefined);
  assert.equal(message.lc_kwargs.additional_kwargs.dialogProcessId, undefined);
  assert.equal(message.lc_kwargs.additional_kwargs.turnScopeId, undefined);
  assert.equal(embedded.sessionId, "current-session");
  assert.equal(embedded.parentSessionId, "");
  assert.equal(embedded.dialogProcessId, "current-dialog");
  assert.equal(embedded.turnScopeId, "current-turn");
  assert.deepEqual(embedded.attachments, [{ attachmentId: "attachment-1" }]);
});

test("snapshot recovery rejects malformed structured user metadata", () => {
  assert.throws(
    () => projectRecoveredMessagesToIdentity([{
      role: "user",
      content: "[用户元信息]\nnot-json\n[/用户元信息]",
      additional_kwargs: { noobotInternalMessageType: "user_meta" },
    }], {
      dialogProcessId: "current-dialog",
      turnScopeId: "current-turn",
    }),
    /requires structured JSON content/,
  );
});

test("continued snapshot recovery rebinds prior tools and new tools to the current round", () => {
  const firstTurn = {
    dialogProcessId: "dialog-first",
    turnScopeId: "turn-first",
  };
  const secondTurn = {
    dialogProcessId: "dialog-second",
    turnScopeId: "turn-second",
  };
  const firstContext = createModelContext({
    activeTurnIdentity: firstTurn,
    messageBlocks: {
      system: [{ role: "system", content: "system" }],
      history: [],
      incremental: [{ role: "user", content: "start", ...firstTurn }],
    },
  });
  appendMessage(firstContext, {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "call-first", name: "read_file", args: {} }],
  }, { block: "incremental" });
  appendMessage(firstContext, {
    role: "tool",
    content: "first result",
    tool_call_id: "call-first",
  }, { block: "incremental" });

  const firstSnapshot = createModelContextSnapshot({
    identity: { ...identity, ...firstTurn },
    messageBlocks: firstContext.messageBlocks,
  });
  const restored = hydrateModelContextSnapshot(firstSnapshot, { ...identity, ...firstTurn });
  const restoredIncremental = projectRecoveredMessagesToIdentity(
    restored.messageBlocks.incremental,
    secondTurn,
  );
  const secondContext = createModelContext({
    activeTurnIdentity: secondTurn,
    messageBlocks: {
      system: restored.messageBlocks.system,
      history: restored.messageBlocks.history,
      incremental: [
        ...restoredIncremental,
        { role: "user", content: "continue", ...secondTurn },
      ],
    },
  });
  appendMessage(secondContext, {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "call-second", name: "search", args: {} }],
  }, { block: "incremental" });
  appendMessage(secondContext, {
    role: "tool",
    content: "second result",
    tool_call_id: "call-second",
  }, { block: "incremental" });

  const pairs = secondContext.messageBlocks.incremental.map((message = {}) => ({
    dialogProcessId: message.dialogProcessId,
    turnScopeId: message.turnScopeId,
  }));
  assert.deepEqual(pairs, [secondTurn, secondTurn, secondTurn, secondTurn, secondTurn, secondTurn]);
});
