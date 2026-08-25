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
  restoreSnapshotUserAttachmentFactsFromSessionAuthority,
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
  assert.equal(continuedSnapshotMessages[1].content, userMetaContent);
});

test("snapshot attachment facts come only from matching Session authority", () => {
  const derivedMeta = {
    type: "human",
    content: "[User Metadata]",
    additional_kwargs: {
      noobotMessageId: "source-user::user_meta",
      frontendUserMessage: true,
      noobotInternalMessageType: "user_meta",
    },
  };
  const restored = restoreSnapshotUserAttachmentFactsFromSessionAuthority(
    {
      system: [{ type: "system", content: "system" }],
      history: [
        {
          type: "human",
          content: "source",
          additional_kwargs: {
            noobotMessageId: "source-user",
            frontendUserMessage: true,
          },
        },
      ],
      incremental: [derivedMeta],
    },
    [
      {
        role: "user",
        messageUid: "source-user",
        attachments: [{ attachmentId: "attachment-authority" }],
      },
    ],
  );

  assert.deepEqual(restored.history[0].attachments, [{ attachmentId: "attachment-authority" }]);
  assert.equal(restored.incremental[0], derivedMeta);
});

test("persisted snapshot user sources require canonical identity", () => {
  assert.throws(
    () =>
      restoreSnapshotUserAttachmentFactsFromSessionAuthority(
        {
          incremental: [{ type: "human", content: "source", frontendUserMessage: true }],
        },
        [],
      ),
    /requires canonical message identity/,
  );
});

test("snapshot restoration requires the Session authority message collection", () => {
  assert.throws(
    () => restoreSnapshotUserAttachmentFactsFromSessionAuthority({}),
    /Session authority messages must be an array/,
  );
});

test("persisted snapshot user sources must exist in Session authority", () => {
  assert.throws(
    () =>
      restoreSnapshotUserAttachmentFactsFromSessionAuthority(
        {
          incremental: [
            {
              type: "human",
              content: "source",
              messageUid: "missing-user",
              frontendUserMessage: true,
            },
          ],
        },
        [],
      ),
    /missing from Session authority: missing-user/,
  );
});

test("snapshot user source identity cannot resolve to another Session role", () => {
  assert.throws(
    () =>
      restoreSnapshotUserAttachmentFactsFromSessionAuthority(
        {
          incremental: [
            {
              type: "human",
              content: "source",
              messageUid: "source-user",
              frontendUserMessage: true,
            },
          ],
        },
        [{ role: "assistant", messageUid: "source-user" }],
      ),
    /conflicts with Session authority role: source-user/,
  );
});
