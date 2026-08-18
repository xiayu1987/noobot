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
  projectSnapshotIncrementalToContinuation,
  serializeContextMessage,
} from "../src/policy/snapshot.js";

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
      history: [
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "call", name: "tool" }],
          custom: { value: 1 },
        },
      ],
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

test("continued snapshot recovery preserves stored facts and rebinds only incremental execution", () => {
  const firstTurn = {
    dialogProcessId: "dialog-first",
    turnScopeId: "turn-first",
  };
  const secondTurn = {
    dialogProcessId: "dialog-second",
    turnScopeId: "turn-second",
  };
  const userMetaContent = `[用户元信息]\n${JSON.stringify(firstTurn)}\n[/用户元信息]`;
  const storedBlocks = {
    system: [{ role: "system", content: "system" }],
    history: [],
    incremental: [
      { role: "user", content: "start", ...firstTurn },
      {
        role: "user",
        content: userMetaContent,
        additional_kwargs: {
          noobotInternalMessageType: "user_meta",
          ...firstTurn,
        },
        ...firstTurn,
      },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call-first", name: "read_file", args: {} }],
        ...firstTurn,
      },
      {
        role: "tool",
        content: "first result",
        tool_call_id: "call-first",
        ...firstTurn,
      },
    ],
  };
  const firstSnapshot = createModelContextSnapshot({
    identity: { ...identity, ...firstTurn },
    messageBlocks: storedBlocks,
  });
  const restored = hydrateModelContextSnapshot(firstSnapshot, { ...identity, ...firstTurn });

  assert.deepEqual(
    Object.fromEntries(
      Object.entries(restored.messageBlocks).map(([name, messages]) => [
        name,
        messages.map(serializeContextMessage),
      ]),
    ),
    firstSnapshot.messageBlocks,
  );
  assert.equal(restored.messageBlocks.incremental[1].content, userMetaContent);
  assert.deepEqual(
    restored.messageBlocks.incremental.map((message) => ({
      dialogProcessId: message.dialogProcessId,
      turnScopeId: message.turnScopeId,
    })),
    Array(4).fill(firstTurn),
  );

  const continuedSnapshotMessages = projectSnapshotIncrementalToContinuation(
    restored.messageBlocks.incremental,
    {
      userName: "admin",
      sessionId: "session",
      parentSessionId: "",
      parentDialogProcessId: "",
      ...secondTurn,
    },
  );
  const continuedIncremental = [
    ...continuedSnapshotMessages,
    { role: "user", content: "continue", ...secondTurn },
  ];
  assert.deepEqual(
    continuedIncremental.map((message) => ({
      dialogProcessId: message.dialogProcessId,
      turnScopeId: message.turnScopeId,
    })),
    Array(5).fill(secondTurn),
  );
  assert.equal(restored.messageBlocks.incremental[1].content, userMetaContent);
  assert.notEqual(continuedSnapshotMessages[1].content, userMetaContent);
  assert.match(continuedSnapshotMessages[1].content, /"dialogProcessId": "dialog-second"/);
});
