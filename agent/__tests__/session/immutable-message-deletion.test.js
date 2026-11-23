/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  readCommittedIndex,
  forbidRecordReads,
  forbidMutationBodyReads,
} from "./helpers/immutable-record-reads.js";
import { mkdtemp, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  createEmptyTurnLifecycle,
  parseMessageDeleteRequest,
  createMessageDeleteFingerprint,
  SESSION_COMMAND,
} from "@noobot/session-protocol";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { openImmutableSessionReader } from "../../src/session/session-artifact-session/immutable-session-reader.js";
import { commitSessionChanges } from "../helpers/commit-immutable-session-fixture.js";
import { registerDialogOrderMessage } from "../../src/session/entities/dialog-order-entity.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { upgradeImmutableMessageTailIndex } from "../../src/session/session-artifact-session/immutable-message-tail-index-upgrade.js";
import { immutableLifecycleCommandKey } from "../../src/session/session-artifact-session/immutable-command-index.js";

const ts = "2026-01-01T00:00:00.000Z";
function message(uid, scope = uid, dialog = scope) {
  return {
    messageUid: uid,
    userMessageId: uid,
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: dialog,
    parentDialogProcessId: "",
    turnScopeId: scope,
    role: "user",
    messageOrigin: "natural",
    type: "message",
    content: uid,
    attachments: [],
    ts,
  };
}
async function fixture(t, messages, { aggregateVersion = 0, commandReceipts = [] } = {}) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-delete-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  await initializeImmutableSession({
    sessionDir,
    operationId: "initialize",
    session: {
      sessionId: "s1",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      aggregateVersion,
      messages,
      dialogOrder: messages.reduce(registerDialogOrderMessage, []),
      turnTimings: [],
      sessionArtifactEvents: [],
      turnLifecycle: { ...createEmptyTurnLifecycle(), commandReceipts },
      createdAt: ts,
      updatedAt: ts,
    },
  });
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "s1" });
  const open = () =>
    openImmutableSessionReader({ sessionDir, sessionId: "s1", parentSessionId: "" });
  const commit = async (changes, operationId, generation) =>
    commitSessionChanges({
      sessionDir,
      sessionId: "s1",
      expectedGeneration: generation ?? (await store.snapshot()).generation,
      operationId,
      changes,
      committedAt: ts,
    });
  return { store, open, commit };
}
const deletion = (scope, commandId = "delete") => ({
  messageDeletion: { anchor: { turnScopeId: scope }, commandId, expectedAggregateVersion: 0 },
});

test("deleting the tail reads only the retained title prefix and no removed body", async (t) => {
  const title = "12345678901234567890";
  const { store, open, commit } = await fixture(t, [
    { ...message("keep"), content: title + "body".repeat(50000) },
    { ...message("drop"), content: "removed ".repeat(25000) },
  ]);
  setFsAdapter(await forbidMutationBodyReads(store, "keep", "drop"));
  try {
    await commit(deletion("drop"), "delete");
    const reader = await open();
    assert.equal((await reader.readMetadata({ includeAutoTitle: true })).autoTitle, title);
    assert.equal(await reader.readMessage("drop"), null);
  } finally {
    resetFsAdapter();
  }
});

test("deletion protocol rejects ambiguous anchors and unknown fields", () => {
  for (const request of [
    null,
    {},
    { commandId: "c", anchor: {} },
    { commandId: "c", anchor: { turnScopeId: " t" } },
    { commandId: "c", anchor: { turnScopeId: "t", messageUid: "m" } },
    { commandId: "c", anchor: { turnScopeId: "t" }, extra: true },
  ])
    assert.throws(() => parseMessageDeleteRequest(request), TypeError);
});

test("deletion publishes the suffix, indexes and receipt together, pins older readers and replays after restart", async (t) => {
  const { store, open, commit } = await fixture(t, [
    message("keep"),
    message("anchor", "target"),
    message("tail"),
  ]);
  const before = await open();
  const result = await commit(deletion("target"), "delete", before.generation);
  assert.deepEqual(result.result.messageDeletion.receipt.result, {
    deletedCount: 2,
    anchorIndex: 1,
    deletedTurnScopeIds: ["target", "tail"],
  });
  const after = await open();
  assert.equal(after.generation, before.generation + 1);
  assert.equal(await after.readMessage("anchor"), null);
  assert.equal(await after.readTurnDescriptor("target"), null);
  assert.equal(await after.readDialog("target"), null);
  assert.deepEqual(
    (await after.exportSession()).messages.map((item) => item.messageUid),
    ["keep"],
  );
  assert.equal((await before.readMessage("anchor")).message.messageUid, "anchor");
  assert.deepEqual(await commit(deletion("target"), "delete", before.generation), {
    ...result,
    replayed: true,
  });
  const retried = await commit(deletion("target"), "new-operation");
  assert.equal(retried.result.messageDeletion.deduplicated, true);
  assert.deepEqual(retried.result.messageDeletion.receipt, result.result.messageDeletion.receipt);
  await commit({ messages: [message("new")] }, "append");
  assert.deepEqual(
    (await (await open()).exportSession()).messages.map((item) => item.messageUid),
    ["keep", "new"],
  );
  assert.equal((await store.get(await store.snapshot(), "metadata", "facts")).messageCount, 2);
});

test("head publication failure exposes no partial deletion and permits the identical request to retry", async (t) => {
  const { store, open, commit } = await fixture(t, [message("keep"), message("anchor")]);
  const before = await store.snapshot();
  setFsAdapter({
    rename: async (source, target) => {
      if (target === store.headPath) throw Object.assign(new Error("injected"), { code: "EIO" });
      return rename(source, target);
    },
  });
  try {
    await assert.rejects(commit(deletion("anchor"), "delete", before.generation), {
      code: "SESSION_COMMIT_UNCERTAIN",
    });
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(await store.snapshot(), before);
  assert.notEqual(await (await open()).readMessage("anchor"), null);
  assert.equal(await (await open()).readCommand("delete"), null);
  await commit(deletion("anchor"), "delete", before.generation);
  assert.equal(await (await open()).readMessage("anchor"), null);
});

test("interleaved turns retain their earlier messages and permit subsequent indexed updates", async (t) => {
  const { open, commit } = await fixture(t, [
    message("a1", "a", "d"),
    message("b1", "b", "d"),
    message("a2", "a", "d"),
  ]);
  await commit(deletion("b"), "delete");
  const reader = await open();
  assert.equal((await reader.readTurnDescriptor("a")).messageCount, 1);
  assert.deepEqual(
    (await reader.readTurnPage({ turnScopeId: "a" })).records.map(
      (item) => item.message.messageUid,
    ),
    ["a1"],
  );
  assert.equal(await reader.readTurnDescriptor("b"), null);
  await commit({ messages: [message("a3", "a", "d")] }, "append");
  assert.deepEqual(
    (await (await open()).exportSession()).messages.map((item) => item.messageUid),
    ["a1", "a3"],
  );
});

test("command source replays exact deleted UIDs after interleaved deletion, append, retry and reopen", async (t) => {
  const { store, open, commit } = await fixture(t, [
    message("a1", "a", "d"),
    message("b1", "b", "d"),
    message("a2", "a", "d"),
  ]);
  const deleted = await commit(deletion("b"), "delete");
  const deletionReader = await open();
  await commit({ messages: [message("a3", "a", "d")] }, "append");
  const retried = await commit(deletion("b"), "retry-delete");
  assert.equal(retried.result.messageDeletion.deduplicated, true);
  const reopened = await ImmutableSessionStore.open({ sessionDir: store.sessionDir });
  const pinned = await reopened.snapshot();
  const source = await reopened.get(
    pinned,
    "commandCommits",
    immutableLifecycleCommandKey("delete"),
  );
  assert.deepEqual(source, { kind: "commit", generation: deleted.generation });
  const delta = await (await open()).readCommandChanges("delete");
  assert.equal(delta.kind, "commit");
  assert.equal(delta.generation, source.generation);
  assert.deepEqual(delta.receipt, deleted.result.messageDeletion.receipt);
  assert.deepEqual(await deletionReader.readCommandChanges("delete"), delta);
  assert.equal(
    delta.changes.some((change) => change.collection === "commands"),
    false,
  );
  assert.deepEqual(
    delta.changes
      .filter((change) => change.collection === "messages")
      .map((change) => ({ uid: change.key, remove: change.remove })),
    [
      { uid: "a2", remove: true },
      { uid: "b1", remove: true },
    ],
  );
  assert.deepEqual(
    delta.changes
      .filter((change) => change.collection === "turns" && change.remove)
      .map((change) => change.key),
    ["b"],
  );
  assert.equal(
    delta.changes.find((change) => change.collection === "turns" && change.key === "a").value
      .messageCount,
    1,
  );
  assert.equal((await reopened.get(pinned, "messages", "a1")).message.messageUid, "a1");
  assert.equal((await reopened.get(pinned, "messages", "a3")).message.messageUid, "a3");
});

test("imported deletion receipts remain baseline acknowledgements and never describe imported messages as deleted", async (t) => {
  const request = deletion("retired", "historical-delete");
  const receipt = {
    type: SESSION_COMMAND.MESSAGE_DELETE_FROM,
    commandId: "historical-delete",
    requestHash: createMessageDeleteFingerprint(request.messageDeletion),
    aggregateVersion: 1,
    committedAt: ts,
    result: { deletedCount: 2, anchorIndex: 1, deletedTurnScopeIds: ["retired"] },
  };
  const { store, open, commit } = await fixture(t, [message("retained"), message("later")], {
    aggregateVersion: 1,
    commandReceipts: [receipt],
  });
  const before = await store.snapshot();
  const replay = await commit(request, "retry-imported-command");
  assert.equal(replay.result.messageDeletion.deduplicated, true);
  assert.deepEqual(replay.result.messageDeletion.receipt, receipt);
  assert.equal((await store.snapshot()).generation, before.generation);
  const source = await store.get(
    before,
    "commandCommits",
    immutableLifecycleCommandKey(receipt.commandId),
  );
  assert.deepEqual(source, { kind: "baseline", generation: 1 });
  const imported = await store.readCommitChanges(before, {
    generation: 1,
    collections: ["messages"],
  });
  assert.equal(imported.changes.length, 2);
  assert.ok(imported.changes.every((change) => !change.remove));
  assert.deepEqual(await (await open()).readCommandChanges(receipt.commandId), {
    kind: "baseline",
    generation: 1,
    receipt,
    changes: null,
  });
  assert.deepEqual(
    (await (await open()).exportSession()).messages.map((item) => item.messageUid),
    ["retained", "later"],
  );
});

test("command changes reject corrupt origins and never substitute a different commit", async (t) => {
  const { store, open, commit } = await fixture(t, [message("keep"), message("anchor")]);
  const before = await open();
  assert.equal(await before.readCommandChanges("delete"), null);
  for (const commandId of [null, "", " delete", 1])
    await assert.rejects(before.readCommandChanges(commandId), TypeError);
  const deleted = await commit(deletion("anchor"), "delete");
  const validReader = await open();
  const valid = await validReader.readCommandChanges("delete");
  await commit({ messages: [message("later")] }, "append");
  const key = immutableLifecycleCommandKey("delete");
  for (const [index, origin] of [
    null,
    {},
    { kind: "commit", generation: 0 },
    { kind: "commit", generation: deleted.generation + 100 },
    { kind: "baseline", generation: deleted.generation },
    { kind: "commit", generation: deleted.generation, extra: true },
    { kind: "baseline", generation: 1 },
    { kind: "commit", generation: deleted.generation + 1 },
  ].entries()) {
    await store.commit({
      expectedGeneration: (await store.snapshot()).generation,
      operationId: `corrupt-origin:${index}`,
      changes: [
        origin === null
          ? { collection: "commandCommits", key, remove: true }
          : { collection: "commandCommits", key, value: origin },
      ],
    });
    await assert.rejects((await open()).readCommandChanges("delete"), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
    assert.deepEqual(await validReader.readCommandChanges("delete"), valid);
  }
});

test("command changes do not read retained or subsequently appended message bodies", async (t) => {
  const { store, open, commit } = await fixture(t, [message("keep"), message("anchor")]);
  await commit(deletion("anchor"), "delete");
  await commit({ messages: [message("later")] }, "append");
  const snapshot = await store.snapshot();
  const root = await readCommittedIndex(store, snapshot.root, "messages");
  const references = await Promise.all(
    ["keep", "later"].map((uid) => readCommittedIndex(store, root, uid)),
  );
  let delta;
  setFsAdapter(await forbidRecordReads(store, references));
  try {
    delta = await (await open()).readCommandChanges("delete");
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(
    delta.changes.filter((change) => change.collection === "messages"),
    [{ collection: "messages", key: "anchor", remove: true }],
  );
});

test("deleting all messages resets the tail and supports a new dialog without retaining old indexes", async (t) => {
  const { open, commit } = await fixture(t, [message("a"), message("b")]);
  await commit(deletion("a"), "delete");
  const session = await (await open()).exportSession();
  assert.deepEqual(session.messages, []);
  assert.deepEqual(session.dialogOrder, []);
  assert.equal(session.autoTitle, undefined);
  await commit({ messages: [message("c")] }, "append");
  assert.equal((await (await open()).readFacts()).lastMessageUid, "c");
});

test("deletion publishes related state together and preserves retained state after a failed publication", async (t) => {
  const { store, open, commit } = await fixture(t, [message("keep"), message("anchor")]);
  for (const scope of ["keep", "anchor"]) {
    for (const [eventType, phase, extra] of [
      [
        "turn.action_accepted",
        "action",
        {
          action: "send",
          dialogProcessId: scope,
          presentationMessageId: `p:${scope}`,
          executionId: `agent:${scope}`,
          executionKind: "agent",
          rootExecutionId: `agent:${scope}`,
        },
      ],
      ["turn.processing_started", "processing", {}],
      ["turn.processing_completed", "completion", { completionCommitId: `completed:${scope}` }],
      [
        "turn.completed",
        "completion",
        {
          commandId: `completed:${scope}`,
          terminalStatus: { command: "completed" },
        },
      ],
    ]) {
      const result = await commit(
        {
          turnTransition: {
            eventType,
            phase,
            sessionId: "s1",
            turnScopeId: scope,
            commandId: `${eventType}:${scope}`,
            causationId: `${eventType}:${scope}`,
            ...extra,
          },
        },
        `${eventType}:${scope}`,
      );
      assert.equal(result.result.turnTransition.applied, true);
    }
    await commit(
      {
        timings: [{ turnScopeId: scope, dialogProcessId: scope, modelLoopRound: 1 }],
        summaryCheckpoints: [
          {
            userId: "admin",
            sessionId: "s1",
            dialogProcessId: scope,
            turnScopeId: scope,
            checkpointId: `cp:${scope}`,
            expectedCheckpointRevision: 0,
            persistedMessageUids: [],
            summarizedMessageUids: [scope],
            retainedMessageUids: [],
            messages: [],
          },
        ],
      },
      `checkpoint:${scope}`,
    );
  }
  const before = await store.snapshot();
  const oldReader = await open();
  const request = {
    messageDeletion: {
      anchor: { turnScopeId: "anchor" },
      commandId: "delete",
      expectedAggregateVersion: null,
    },
  };
  const keys = [
    ["messages", "anchor"],
    ["turns", "anchor"],
    ["lifecycle", "anchor"],
    ["timings", "anchor"],
    ["checkpointHeads", "anchor"],
    ["turnCheckpoints", "anchor"],
    ["messageCheckpoints", "anchor"],
    ["checkpoints", JSON.stringify(["anchor", "cp:anchor"])],
    ["commands", JSON.stringify(["lifecycle", "turn.action_accepted:anchor"])],
    ["turnCommands", "anchor"],
    ["turnOutbox", "anchor"],
  ];
  const beforeValues = await Promise.all(
    keys.map(([collection, key]) => store.get(before, collection, key)),
  );
  assert.ok(beforeValues.every((value) => value !== null));
  const oldEvents = (await oldReader.readOutboxPage({ consumerId: "client" })).events;
  assert.equal(oldEvents.length, 8);
  setFsAdapter({
    rename: async (source, target) => {
      if (target === store.headPath) throw Object.assign(new Error("injected"), { code: "EIO" });
      return rename(source, target);
    },
  });
  try {
    await assert.rejects(commit(request, "delete", before.generation), {
      code: "SESSION_COMMIT_UNCERTAIN",
    });
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(await store.snapshot(), before);
  assert.deepEqual(
    await Promise.all(keys.map(([collection, key]) => store.get(before, collection, key))),
    beforeValues,
  );
  await commit(request, "delete", before.generation);
  const after = await store.snapshot();
  for (const [collection, key] of keys)
    assert.equal(await store.get(after, collection, key), null, `${collection}:${key}`);
  const reader = await open();
  for (const event of oldEvents) {
    const removed = event.envelope.identity.turnScopeId === "anchor";
    assert.equal((await reader.readOutboxEvent(event.eventId)) === null, removed);
    assert.notEqual(await store.get(after, "events", event.eventId), null);
  }
  assert.notEqual(await reader.readTurnState("keep"), null);
  assert.notEqual(await reader.readCheckpoint("keep", "cp:keep"), null);
  assert.notEqual(await reader.readTurnTiming("keep"), null);
  assert.notEqual(await reader.readCommand("turn.action_accepted:keep"), null);
  assert.equal((await oldReader.readOutboxPage({ consumerId: "client" })).events.length, 8);
  assert.notEqual(await oldReader.readCheckpoint("anchor", "cp:anchor"), null);
  assert.equal((await commit(request, "retry")).result.messageDeletion.deduplicated, true);
});

test("interleaved deletion reports affected scopes in their first occurrence order", async (t) => {
  const { commit } = await fixture(t, [
    message("a1", "a", "d"),
    message("b1", "b", "d"),
    message("a2", "a", "d"),
  ]);
  const result = await commit(deletion("a"), "delete");
  assert.deepEqual(result.result.messageDeletion.receipt.result.deletedTurnScopeIds, ["a", "b"]);
});

test("suffix deletion preserves only bindings whose messages survive", async (t) => {
  const { commit, open } = await fixture(t, [
    message("retained", "a", "d"),
    message("anchor", "b", "d"),
    message("removed", "a", "d"),
  ]);
  const bind = (messageUid, expectedAggregateVersion) => ({
    attachmentBinding: {
      userId: "u1",
      sessionId: "s1",
      turnScopeId: "a",
      messageUid,
      commandId: `bind-${messageUid}`,
      expectedAggregateVersion,
      attachments: [
        {
          attachmentId: messageUid,
          sessionId: "s1",
          attachmentSource: "user",
          name: "input.txt",
          mimeType: "text/plain",
        },
      ],
    },
  });
  await commit(bind("retained", 0), "keep-binding");
  await commit(bind("removed", 1), "drop-binding");
  await using oldReader = await open();
  await commit(
    { messageDeletion: { ...deletion("b").messageDeletion, expectedAggregateVersion: 2 } },
    "delete",
  );
  await using reader = await open();
  assert.ok(await oldReader.readCommand("bind-removed"));
  assert.equal(await reader.readCommand("bind-removed"), null);
  assert.ok(await reader.readCommand("bind-retained"));
  assert.equal(
    (await commit(bind("retained", 0), "retry-binding")).result.attachmentBinding.deduplicated,
    true,
  );
});

test("interleaved dialogs preserve display tail ordering through deletion and append", async (t) => {
  const { store, commit } = await fixture(t, [
    message("a1", "a1", "a"),
    message("b1", "b", "b"),
    message("a2", "a2", "a"),
    message("c1", "c", "c"),
  ]);
  const before = await store.snapshot();
  await commit(deletion("c"), "delete-c");
  const after = await store.snapshot();
  assert.equal((await store.get(after, "metadata", "facts")).lastMessageUid, "b1");
  assert.equal((await store.get(before, "dialogTails", "b")).nextDialogProcessId, "c");
  assert.equal((await store.get(after, "dialogTails", "b")).nextDialogProcessId, "");
  await commit({ messages: [message("a3", "a3", "a")] }, "append-a");
  assert.equal((await store.get(await store.snapshot(), "metadata", "facts")).lastMessageUid, "b1");
  await commit(
    {
      messageDeletion: {
        ...deletion("b").messageDeletion,
        expectedAggregateVersion: 1,
        commandId: "delete-b",
      },
    },
    "delete-b",
  );
  const retained = await store.snapshot();
  assert.equal((await store.get(retained, "metadata", "facts")).lastMessageUid, "a1");
  assert.deepEqual(await store.get(retained, "dialogTails", "a"), {
    messageUid: "a1",
    previousDialogProcessId: "",
    nextDialogProcessId: "",
  });
  for (const uid of ["a2", "a3", "b1", "c1"])
    assert.equal(await store.get(retained, "messagePredecessors", uid), null);
  await commit({ messages: [message("b2", "new-b", "b")] }, "append-b");
  assert.equal((await store.get(await store.snapshot(), "metadata", "facts")).lastMessageUid, "b2");
});

test("offline tail upgrade isolates publication failure, retries and skips historical bodies once upgraded", async (t) => {
  const { store } = await fixture(t, [
    message("a1", "a1", "a"),
    message("b1", "b", "b"),
    message("a2", "a2", "a"),
  ]);
  await store.commit({
    expectedGeneration: (await store.snapshot()).generation,
    operationId: "retire-tail-version",
    changes: [{ collection: "metadata", key: "messageTailIndex", remove: true }],
  });
  const before = await store.snapshot();
  const upgrade = () =>
    upgradeImmutableMessageTailIndex({ sessionDir: store.sessionDir, sessionId: store.sessionId });
  setFsAdapter({
    rename: async (source, target) => {
      if (target === store.headPath) throw Object.assign(new Error("injected"), { code: "EIO" });
      return rename(source, target);
    },
  });
  try {
    await assert.rejects(upgrade(), { code: "SESSION_COMMIT_UNCERTAIN" });
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(await store.snapshot(), before);
  assert.equal((await upgrade()).result.upgraded, true);
  const after = await store.snapshot();
  assert.equal((await store.get(after, "metadata", "facts")).lastMessageUid, "b1");
  assert.deepEqual(await store.get(after, "messagePredecessors", "a2"), {
    previousMessageUid: "a1",
    userMessageUid: "a2",
  });
  const reference = await readCommittedIndex(
    store,
    await readCommittedIndex(store, after.root, "messages"),
    "a1",
  );
  setFsAdapter(await forbidRecordReads(store, [reference]));
  try {
    assert.equal((await upgrade()).result.upgraded, false);
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(await store.snapshot(), after);
});

test("partial turn deletion retains its summary state, live receipts, flags and timing", async (t) => {
  const { store, commit } = await fixture(t, [
    message("a1", "a", "d"),
    message("b1", "b", "d"),
    message("a2", "a", "d"),
  ]);
  await commit(
    {
      turnTransition: {
        eventType: "turn.action_accepted",
        phase: "action",
        action: "send",
        sessionId: "s1",
        turnScopeId: "a",
        dialogProcessId: "d",
        presentationMessageId: "p:a",
        executionId: "agent:a",
        executionKind: "agent",
        rootExecutionId: "agent:a",
        commandId: "accept-a",
        causationId: "accept-a",
      },
    },
    "accept-a",
  );
  for (const [index, uid] of ["a1", "a2"].entries()) {
    await commit(
      {
        summaryCheckpoints: [
          {
            userId: "admin",
            sessionId: "s1",
            dialogProcessId: "d",
            turnScopeId: "a",
            checkpointId: `cp:${uid}`,
            expectedCheckpointRevision: index,
            messages: [],
            persistedMessageUids: [],
            summarizedMessageUids: [uid],
            retainedMessageUids: [],
          },
        ],
      },
      `checkpoint:${uid}`,
    );
  }
  await commit(
    { timings: [{ turnScopeId: "a", dialogProcessId: "d", modelLoopRound: 1 }] },
    "timing",
  );
  const before = await store.snapshot();
  await commit(
    { messageDeletion: { ...deletion("b").messageDeletion, expectedAggregateVersion: null } },
    "delete",
  );
  const after = await store.snapshot();
  for (const [collection, key] of [
    ["checkpointHeads", "a"],
    ["timings", "a"],
    ["messages", "a1"],
    ["checkpoints", JSON.stringify(["a", "cp:a1"])],
  ]) {
    const previous = await store.get(before, collection, key);
    assert.ok(previous);
    assert.deepEqual(await store.get(after, collection, key), previous);
  }
  assert.equal((await store.get(after, "turnCheckpoints", "a")).count, 1);
  assert.equal(await store.get(after, "checkpoints", JSON.stringify(["a", "cp:a2"])), null);
  assert.equal((await store.get(before, "turnCheckpoints", "a")).count, 2);
});

test("mutation projection preserves the precise removed suffix of a partially retained turn", async (t) => {
  const { open, commit } = await fixture(t, [
    message("a1", "a", "d"),
    message("b1", "b", "d"),
    message("a2", "a", "d"),
  ]);
  await commit(deletion("b"), "delete");
  const reader = await open();
  const projection = await reader.readMutationProjection("delete");
  assert.equal(projection.kind, "commit");
  assert.equal(projection.generation, reader.generation);
  assert.equal(projection.baseAggregateVersion, 0);
  assert.equal(projection.metadata.aggregateVersion, 1);
  assert.deepEqual(projection.messageSuffix, { firstOrdinal: 2, previousMessageCount: 3 });
  assert.deepEqual(projection.messages, []);
  assert.deepEqual(new Set(projection.turns.map((entry) => entry.key)), new Set(["a", "b"]));
  assert.ok(projection.turns.every((entry) => entry.value === null));
  assert.equal((await reader.readMessage("a1")).message.messageUid, "a1");
});

test("mutation projection remains the original effect after later appends, edits and command replay", async (t) => {
  const { open, commit } = await fixture(t, [message("keep"), message("drop")]);
  await commit(deletion("drop"), "delete");
  const pinned = await open();
  const original = await pinned.readMutationProjection("delete");
  await commit({ messages: [message("later")] }, "append");
  await commit({ messages: [{ ...message("keep"), content: "edited later" }] }, "edit");
  await commit(deletion("drop"), "replay");
  assert.deepEqual(await (await open()).readMutationProjection("delete"), original);
  assert.deepEqual(await pinned.readMutationProjection("delete"), original);
  assert.equal((await (await open()).readMessage("keep")).message.content, "edited later");
});

test("mutation projection does not read retained or subsequently appended message bodies", async (t) => {
  const { store, open, commit } = await fixture(t, [message("keep"), message("drop")]);
  await commit(deletion("drop"), "delete");
  const original = await (await open()).readMutationProjection("delete");
  await commit({ messages: [message("later")] }, "append");
  const snapshot = await store.snapshot();
  const root = await readCommittedIndex(store, snapshot.root, "messages");
  const references = await Promise.all(
    ["keep", "later"].map((uid) => readCommittedIndex(store, root, uid)),
  );
  setFsAdapter(await forbidRecordReads(store, references));
  try {
    assert.deepEqual(await (await open()).readMutationProjection("delete"), original);
  } finally {
    resetFsAdapter();
  }
});

test("imported mutation projection exposes acknowledgement without inventing a deletion effect", async (t) => {
  const command = deletion("drop").messageDeletion;
  const receipt = {
    type: SESSION_COMMAND.MESSAGE_DELETE_FROM,
    commandId: command.commandId,
    requestHash: createMessageDeleteFingerprint(command),
    aggregateVersion: 1,
    committedAt: ts,
    result: { deletedCount: 1, anchorIndex: 1, deletedTurnScopeIds: ["drop"] },
  };
  const { open } = await fixture(t, [message("keep")], {
    aggregateVersion: 1,
    commandReceipts: [receipt],
  });
  assert.deepEqual(await (await open()).readMutationProjection("delete"), {
    kind: "baseline",
    generation: 1,
    receipt,
  });
  assert.equal(await (await open()).readMutationProjection("missing"), null);
});
