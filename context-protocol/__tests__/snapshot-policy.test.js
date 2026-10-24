/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  SNAPSHOT_VERSION,
  createModelContextSnapshot,
  hydrateModelContextSnapshot,
  projectSnapshotIncrementalToContinuation,
  restoreSnapshotUserAttachmentFactsFromSessionAuthority,
  serializeContextMessage,
} from "../src/policy/snapshot.js";
import {
  readContextMessageField,
  readContextMessageValue,
  resolveContextMessageSummarized,
} from "../src/message/codec.js";

function roundOf(message) {
  return {
    dialogProcessId: readContextMessageField(message, "dialogProcessId"),
    turnScopeId: readContextMessageField(message, "turnScopeId"),
  };
}

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
      system: [{ role: "system", content: "system", additional_kwargs: { messageUid: "sm_sys" } }],
      history: [
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "call", name: "tool" }],
          additional_kwargs: { custom: { value: 1 } },
        },
      ],
      incremental: [
        {
          role: "tool",
          content: "result",
          tool_call_id: "call",
          additional_kwargs: { summarized: true },
        },
      ],
    },
  });
  const hydrated = hydrateModelContextSnapshot(snapshot, identity);

  assert.equal(snapshot.version, SNAPSHOT_VERSION);
  assert.deepEqual(hydrated.messageBlocks.history[0].tool_calls, [{ id: "call", name: "tool" }]);
  assert.deepEqual(readContextMessageValue(hydrated.messageBlocks.history[0], "custom"), {
    value: 1,
  });
  assert.equal(hydrated.messageBlocks.incremental[0].tool_call_id, "call");
  assert.equal(resolveContextMessageSummarized(hydrated.messageBlocks.incremental[0]), true);
  assert.equal(hydrated.messages.length, 3);
});

test("snapshot serialization rejects noobot facts outside additional_kwargs", () => {
  assert.throws(
    () => serializeContextMessage({ role: "assistant", content: "", custom: { value: 1 } }),
    /top-level field is not part of the protocol: custom/,
  );
  assert.throws(
    () => serializeContextMessage({ role: "user", content: "x", dialogProcessId: "dialog" }),
    /top-level field is not part of the protocol: dialogProcessId/,
  );
});

test("snapshot serialization accepts LangChain native ToolMessage metadata key without persisting it", () => {
  const serialized = serializeContextMessage({
    type: "tool",
    content: "tool output",
    tool_call_id: "call-1",
    metadata: { native: true },
    additional_kwargs: { messageUid: "sm_tool" },
  });
  assert.equal("metadata" in serialized, false);
  assert.equal(serialized.tool_call_id, "call-1");
  assert.equal(readContextMessageValue(serialized, "messageUid"), "sm_tool");
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
    system: [{ role: "system", content: "system", additional_kwargs: { messageUid: "sm_sys" } }],
    history: [],
    incremental: [
      { role: "user", content: "start", additional_kwargs: { ...firstTurn } },
      {
        role: "user",
        content: userMetaContent,
        additional_kwargs: {
          noobotInternalMessageType: "user_meta",
          ...firstTurn,
        },
      },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call-first", name: "read_file", args: {} }],
        additional_kwargs: { ...firstTurn },
      },
      {
        role: "tool",
        content: "first result",
        tool_call_id: "call-first",
        additional_kwargs: { ...firstTurn },
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
  assert.deepEqual(restored.messageBlocks.incremental.map(roundOf), Array(4).fill(firstTurn));

  const continuedSnapshotMessages = projectSnapshotIncrementalToContinuation(
    restored.messageBlocks.incremental,
    secondTurn,
  );
  const continuedIncremental = [
    ...continuedSnapshotMessages,
    { role: "user", content: "continue", additional_kwargs: { ...secondTurn } },
  ];
  assert.deepEqual(continuedIncremental.map(roundOf), [...Array(4).fill(firstTurn), secondTurn]);
  assert.equal(restored.messageBlocks.incremental[1].content, userMetaContent);
  assert.equal(continuedSnapshotMessages[1].content, userMetaContent);
});

test("snapshot attachment facts come only from matching Session authority", () => {
  const derivedMeta = {
    type: "human",
    content: "[User Metadata]",
    additional_kwargs: {
      projectionType: "user_meta",
      sourceMessageUid: "source-user",
      messageOrigin: "natural",
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
            messageUid: "source-user",
            messageOrigin: "natural",
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

  assert.deepEqual(readContextMessageValue(restored.history[0], "attachments"), [
    { attachmentId: "attachment-authority" },
  ]);
  assert.equal(restored.history[0].attachments, undefined);
  assert.equal(restored.incremental[0], derivedMeta);
});

test("persisted snapshot user sources require canonical identity", () => {
  assert.throws(
    () =>
      restoreSnapshotUserAttachmentFactsFromSessionAuthority(
        {
          incremental: [
            {
              type: "human",
              content: "source",
              additional_kwargs: { messageOrigin: "natural" },
            },
          ],
        },
        [],
      ),
    /context message identity must be exactly one shape, got: none/,
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
              additional_kwargs: {
                messageUid: "missing-user",
                messageOrigin: "natural",
              },
            },
          ],
        },
        [],
      ),
    /missing from Session authority: missing-user/,
  );
});

test("snapshot carries turn progress through persistence and hydration", () => {
  const turnProgress = {
    phaseSummaryLoopCount: 6,
    taskCheckLoopCount: 2,
    helpPromptLoopCount: 0,
    toolConsecutiveFailureCount: 1,
    needsPhaseSummary: true,
    phaseSummaryByCharsPrompted: false,
  };
  const snapshot = createModelContextSnapshot({
    identity,
    now: "2026-08-03T00:00:00.000Z",
    messageBlocks: { system: [], history: [], incremental: [] },
    turnProgress,
  });
  assert.deepEqual(snapshot.turnProgress, turnProgress);
  const roundTripped = hydrateModelContextSnapshot(JSON.parse(JSON.stringify(snapshot)), identity);
  assert.deepEqual(roundTripped.turnProgress, turnProgress);
});

test("snapshot without turn progress hydrates to an empty progress fact", () => {
  const snapshot = createModelContextSnapshot({
    identity,
    now: "2026-08-03T00:00:00.000Z",
    messageBlocks: { system: [], history: [], incremental: [] },
  });
  assert.deepEqual(snapshot.turnProgress, {});
  const legacySnapshot = JSON.parse(JSON.stringify(snapshot));
  delete legacySnapshot.turnProgress;
  const hydrated = hydrateModelContextSnapshot(legacySnapshot, identity);
  assert.deepEqual(hydrated.turnProgress, {});
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
              additional_kwargs: {
                messageUid: "source-user",
                messageOrigin: "natural",
              },
            },
          ],
        },
        [{ role: "assistant", messageUid: "source-user" }],
      ),
    /conflicts with Session authority role: source-user/,
  );
});
