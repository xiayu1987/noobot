/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { IMMUTABLE_MESSAGE_TAIL_VERSION } from "../../src/session/session-artifact-session/immutable-message-tail-index.js";
import { prepareImmutableTurnCommit } from "../../src/session/session-artifact-session/immutable-lifecycle-changes.js";
import { immutableLifecycleCommandKey } from "../../src/session/session-artifact-session/immutable-command-index.js";
import { IMMUTABLE_ARTIFACT_EVENT_INDEX_VERSION } from "@noobot/session-protocol/immutable-storage-graph";
import {
  readImmutableMessage,
  readImmutableTurnPage,
} from "../../src/session/session-artifact-session/immutable-message-reader.js";

const timestamp = "2026-07-30T00:00:00.000Z";
async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-lifecycle-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "session-1",
    allowCreate: true,
  });
  await store.commit({
    expectedGeneration: 0,
    operationId: "initialize",
    changes: [
      {
        collection: "metadata",
        key: "messageTailIndex",
        value: { version: IMMUTABLE_MESSAGE_TAIL_VERSION },
      },
      {
        collection: "metadata",
        key: "session",
        value: { sessionId: store.sessionId, parentSessionId: "", updatedAt: timestamp },
      },
      {
        collection: "metadata",
        key: "facts",
        value: {
          messageCount: 0,
          messageSequence: 0,
          turnSequence: 0,
          dialogSequence: 0,
          lastDialogOrdinal: 0,
          lastMessageOrdinal: 0,
          lastMessageUid: "",
        },
      },
      { collection: "metadata", key: "lifecycle", value: { sequence: 0, activeTurnScopeId: "" } },
      { collection: "metadata", key: "commandIndex", value: { version: 1 } },
      { collection: "metadata", key: "titleIndex", value: { version: 1, root: null } },
      { collection: "metadata", key: "events", value: { sequence: 0, outboxIndexVersion: 1 } },
      {
        collection: "metadata",
        key: "artifactEventIndex",
        value: {
          version: IMMUTABLE_ARTIFACT_EVENT_INDEX_VERSION,
          count: 0,
          root: null,
        },
      },
    ],
  });
  return store;
}
function event(eventType, phase, extra = {}) {
  return {
    eventType,
    phase,
    turnScopeId: "turn-1",
    sessionId: "session-1",
    commandId: eventType,
    causationId: eventType,
    ...extra,
  };
}
function acceptance() {
  return event("turn.action_accepted", "action", {
    action: "send",
    presentationMessageId: "presentation-1",
    dialogProcessId: "dialog-1",
    executionId: "agent:turn-1",
    executionKind: "agent",
    rootExecutionId: "agent:turn-1",
  });
}
function message(uid) {
  return {
    messageUid: uid,
    modelMessageId: uid,
    role: "assistant",
    type: "message",
    presentationMessageId: "presentation-1",
    chatPresentation: false,
    sessionId: "session-1",
    parentSessionId: "",
    turnScopeId: "turn-1",
    dialogProcessId: "dialog-1",
    parentDialogProcessId: "",
    content: "answer",
    attachments: [],
    transferEnvelopes: [],
    pending: true,
    ts: timestamp,
  };
}
async function commit(store, request, messages = [], operationId = request.commandId) {
  const snapshot = await store.snapshot();
  return store.transact({
    expectedGeneration: snapshot.generation,
    operationId,
    input: { event: request, messages },
    prepare: ({ get, getMetadata, input }) =>
      prepareImmutableTurnCommit({
        store,
        get,
        getMetadata,
        ...input,
        now: () => timestamp,
        createEventId: () => `event:${request.commandId}`,
      }),
  });
}

test("one head publishes lifecycle, messages, receipts, events and outbox; rejection publishes nothing", async (t) => {
  const store = await fixture(t);
  const result = await commit(store, acceptance(), [message("m1")]);
  assert.equal(result.result.applied, true);
  const snapshot = await store.snapshot();
  const turn = await store.get(snapshot, "lifecycle", "turn-1");
  assert.equal(turn.state, "action_requesting");
  assert.equal((await store.get(snapshot, "messages", "m1")).message.content, "answer");
  const receipt = await store.get(
    snapshot,
    "commands",
    immutableLifecycleCommandKey("turn.action_accepted"),
  );
  const prepared = await store.get(snapshot, "events", receipt.eventId);
  assert.deepEqual(await store.get(snapshot, "outbox", receipt.eventId), prepared);
  assert.equal(await store.get(snapshot, "eventOrder", "0000000000000001"), receipt.eventId);
  const before = await readFile(store.headPath);
  const replay = await commit(store, acceptance(), [], "replay");
  assert.equal(replay.aborted, true);
  assert.equal(replay.result.deduplicated, true);
  assert.deepEqual(replay.result.envelope, prepared.envelope);
  assert.deepEqual(await readFile(store.headPath), before);
  const rejected = await commit(
    store,
    event("turn.processing_started", "processing", { expectedRevision: 99 }),
  );
  assert.equal(rejected.aborted, true);
  assert.equal(rejected.result.reason, "turn_revision_conflict");
  assert.deepEqual(await readFile(store.headPath), before);
});

test("settling projects pending flags without rewriting messages and preserves snapshot reads", async (t) => {
  const store = await fixture(t);
  await commit(store, acceptance(), [message("m1")]);
  await commit(store, event("turn.processing_started", "processing"));
  await commit(
    store,
    event("turn.processing_completed", "completion", { completionCommitId: "completed" }),
  );
  const before = await store.snapshot();
  const terminal = await commit(
    store,
    event("turn.completed", "completion", {
      commandId: "completed",
      terminalStatus: { command: "completed" },
    }),
  );
  assert.equal(terminal.result.applied, true);
  const after = await store.snapshot();
  assert.equal((await store.get(after, "messages", "m1")).message.pending, true);
  assert.equal((await readImmutableMessage(store, before, "m1")).message.pending, true);
  assert.equal((await readImmutableMessage(store, after, "m1")).message.pending, false);
  const page = await readImmutableTurnPage({ store, snapshot: after, turnScopeId: "turn-1" });
  assert.equal(page.records[0].message.pending, false);
});

test("head replacement failure leaves all business collections unchanged and retry publishes together", async (t) => {
  const store = await fixture(t);
  const previous = await store.snapshot();
  setFsAdapter({
    rename: async (source, target) => {
      if (target === store.headPath) throw Object.assign(new Error("injected"), { code: "EIO" });
      return rename(source, target);
    },
  });
  try {
    await assert.rejects(commit(store, acceptance(), [message("m1")]), {
      code: "SESSION_COMMIT_UNCERTAIN",
    });
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(await store.snapshot(), previous);
  for (const [collection, key] of [
    ["messages", "m1"],
    ["lifecycle", "turn-1"],
    ["events", "event:turn.action_accepted"],
    ["outbox", "event:turn.action_accepted"],
    ["commands", immutableLifecycleCommandKey("turn.action_accepted")],
  ])
    assert.equal(await store.get(previous, collection, key), null);
  assert.equal((await commit(store, acceptance(), [message("m1")])).result.applied, true);
});
