/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, rename, readFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createEmptyTurnLifecycle, SESSION_COMMAND } from "@noobot/session-protocol";
import { normalizeSessionEntity } from "../../src/session/entities/session-entity.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableSessionImportStore } from "../../src/session/session-artifact-session/immutable-session-import-store.js";
import {
  initializeImmutableSession,
  immutableSessionImportProjection,
} from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { exportImmutableSession } from "../../src/session/session-artifact-session/immutable-session-export.js";
import { prepareImmutableTurnCommit } from "../../src/session/session-artifact-session/immutable-lifecycle-changes.js";
import { turnRecord } from "../helpers/turn-record.js";

const ts = "2026-01-01T00:00:00.000Z";
function emptySession() {
  return normalizeSessionEntity({
    sessionId: "s1",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
    aggregateVersion: 0,
    modelAlias: "",
    shortMemoryCheckpoint: 0,
    selectedConnectorIds: [],
    messages: [],
    dialogOrder: [],
    turnTimings: [],
    sessionArtifactEvents: [],
    turnLifecycle: createEmptyTurnLifecycle(),
    createdAt: ts,
    updatedAt: ts,
  });
}
function message(uid, dialogProcessId, turnScopeId) {
  return {
    messageUid: uid,
    userMessageId: uid,
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId,
    parentDialogProcessId: "",
    turnScopeId,
    role: "user",
    messageOrigin: "natural",
    type: "message",
    content: uid,
    attachments: [],
    ts,
  };
}
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "immutable-bootstrap-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return path.join(directory, "session");
}
function openStore(sessionDir) {
  return new ImmutableSessionStore({ sessionDir, sessionId: "s1" });
}
async function exported(store) {
  return exportImmutableSession({ store, snapshot: await store.snapshot() });
}

test("import validates terminal message projections without rewriting stored pending facts", async (t) => {
  for (const state of ["completed", "processing"]) {
    for (const pending of [undefined, true, false]) {
      await t.test(`${state}: pending=${String(pending)}`, async (t) => {
        const sessionDir = await fixture(t);
        const source = emptySession();
        const assistant = {
          sessionId: "s1",
          messageUid: "assistant",
          modelMessageId: "model-assistant",
          presentationMessageId: "message-t1",
          role: "assistant",
          type: "message",
          content: "answer",
          dialogProcessId: "d1",
          turnScopeId: "t1",
          attachments: [],
          ts,
          ...(pending === undefined ? {} : { pending }),
        };
        source.messages = [message("user", "d1", "t1"), assistant];
        source.dialogOrder = [
          { dialogProcessId: "d1", turnScopeId: "t1", userMessageUid: "user", dialogOrdinal: 1 },
        ];
        source.turnLifecycle = {
          ...createEmptyTurnLifecycle(),
          sequence: 1,
          activeTurnScopeId: state === "processing" ? "t1" : "",
          turns: { t1: turnRecord({ turnScopeId: "t1", dialogProcessId: "d1", state }) },
        };
        const before = structuredClone(source);
        const input = { sessionDir, session: source, operationId: "import-terminal" };
        const result = await initializeImmutableSession(input);
        const store = openStore(sessionDir);
        const snapshot = await store.snapshot();
        const stored = await store.get(snapshot, "messages", "assistant");
        assert.equal(stored.message.pending, pending);
        assert.equal(Object.hasOwn(stored.message, "pending"), pending !== undefined);
        const projected = await exported(store);
        assert.equal(projected.messages[1].pending, state === "completed" ? false : pending);
        assert.deepEqual(projected.messages[0], normalizeSessionEntity(source).messages[0]);
        assert.equal(projected.messages[1].content, "answer");
        assert.deepEqual(source, before);
        assert.deepEqual(await initializeImmutableSession(input), { ...result, replayed: true });
      });
    }
  }
});

test("explicit initialization is durable and replayable while ordinary opens reject a missing head", async (t) => {
  const sessionDir = await fixture(t);
  const session = emptySession();
  const input = { sessionDir, session, operationId: "create-session" };
  const result = await initializeImmutableSession(input);
  const store = openStore(sessionDir);
  assert.deepEqual(await exported(store), session);
  assert.deepEqual(await initializeImmutableSession(input), { ...result, replayed: true });
  await assert.rejects(
    initializeImmutableSession({ ...input, session: { ...session, customTitle: "changed" } }),
    { code: "SESSION_OPERATION_CONFLICT" },
  );
  await rm(store.headPath);
  await assert.rejects(store.snapshot(), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
  await assert.rejects(initializeImmutableSession(input), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
});

test("import comparison orders mixed session and turn command receipts consistently", () => {
  const source = emptySession();
  const turnReceipt = (commandId, sequence) => ({
    commandId,
    type: "turn.action_accepted",
    requestHash: `hash:${commandId}`,
    turnScopeId: "t1",
    revision: sequence,
    sequence,
    eventId: `event:${commandId}`,
    committedAt: ts,
  });
  const receipts = [
    turnReceipt("z-first", 1),
    {
      commandId: "middle",
      type: SESSION_COMMAND.TURN_COMMIT,
      requestHash: "hash:middle",
      aggregateVersion: 1,
      committedAt: ts,
      result: { messageUid: "m1" },
    },
    turnReceipt("a-last", 2),
  ];
  source.turnLifecycle.commandReceipts = receipts;
  const before = structuredClone(source);
  const expected = immutableSessionImportProjection(source);
  for (const order of [
    [receipts[2], receipts[1], receipts[0]],
    [receipts[1], receipts[0], receipts[2]],
    [receipts[0], receipts[2], receipts[1]],
  ]) {
    assert.deepEqual(
      immutableSessionImportProjection({
        ...source,
        turnLifecycle: { ...source.turnLifecycle, commandReceipts: order },
      }),
      expected,
    );
  }
  assert.deepEqual(source, before);
});

test("one-shot import separates metadata, preserves dialog ordinals, messages, timings and summary receipts", async (t) => {
  const sessionDir = await fixture(t);
  const source = emptySession();
  source.customTitle = "keep title";
  source.autoTitle = "original auto title";
  source.messages = [message("m1", "d2", "t2"), message("m2", "d1", "t1")];
  source.dialogOrder = [
    { dialogProcessId: "d1", dialogOrdinal: 5, turnScopeId: "t1", userMessageUid: "m2" },
    { dialogProcessId: "d2", dialogOrdinal: 8, turnScopeId: "t2", userMessageUid: "m1" },
  ];
  source.turnTimings = [{ turnScopeId: "t1", dialogProcessId: "d1", thinkingFinishedAt: ts }];
  source.turnSummaryCheckpoints = {
    t2: {
      turnScopeId: "t2",
      dialogProcessId: "d2",
      checkpointRevision: 2,
      receipts: [
        {
          checkpointId: "checkpoint-2",
          checkpointRevision: 2,
          requestHash: "hash-2",
          persistedMessageUids: ["m1"],
          summarizedMessageUids: [],
          retainedMessageUids: ["m1"],
          markedCount: 0,
          committedAt: ts,
        },
      ],
    },
  };
  const expected = normalizeSessionEntity(source);
  await initializeImmutableSession({ sessionDir, session: source, operationId: "import" });
  const store = openStore(sessionDir);
  assert.deepEqual(await exported(store), expected);
  const head = await store.snapshot();
  const metadata = await store.get(head, "metadata", "session");
  for (const key of [
    "messages",
    "dialogOrder",
    "turnTimings",
    "turnLifecycle",
    "turnSummaryCheckpoints",
    "sessionArtifactEvents",
  ])
    assert.equal(Object.hasOwn(metadata, key), false);
  const facts = await store.get(head, "metadata", "facts");
  assert.equal(facts.dialogSequence, 8);
  assert.equal(facts.lastMessageUid, "m1");
  assert.equal((await store.get(head, "turns", "t2")).dialogOrdinal, 8);
});

test("initial head failure publishes no graph and import retries without altering the legacy source", async (t) => {
  const sessionDir = await fixture(t);
  const source = emptySession();
  const before = structuredClone(source);
  const headPath = path.join(sessionDir, "head.json");
  setFsAdapter({
    rename: async (from, target) => {
      if (target === headPath) throw Object.assign(new Error("head failure"), { code: "EIO" });
      return rename(from, target);
    },
  });
  try {
    await assert.rejects(
      initializeImmutableSession({ sessionDir, session: source, operationId: "import" }),
      { code: "SESSION_COMMIT_UNCERTAIN" },
    );
  } finally {
    resetFsAdapter();
  }
  await assert.rejects(readFile(headPath), { code: "ENOENT" });
  await assert.rejects(openStore(sessionDir).snapshot(), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  assert.deepEqual(source, before);
  await initializeImmutableSession({ sessionDir, session: source, operationId: "import" });
  assert.deepEqual(await exported(openStore(sessionDir)), before);
});

test("migration imports command replay events and consumer delivery state in the same committed graph", async (t) => {
  const sessionDir = await fixture(t);
  await initializeImmutableSession({ sessionDir, session: emptySession(), operationId: "create" });
  const store = openStore(sessionDir);
  const event = {
    sessionId: "s1",
    turnScopeId: "t1",
    dialogProcessId: "d1",
    eventType: "turn.action_accepted",
    phase: "action",
    action: "send",
    commandId: "accept",
    causationId: "accept",
    presentationMessageId: "p1",
    executionId: "agent:t1",
    executionKind: "agent",
    rootExecutionId: "agent:t1",
  };
  await store.transact({
    expectedGeneration: 1,
    operationId: "accept",
    input: { event },
    prepare: ({ get, getMetadata, input }) =>
      prepareImmutableTurnCommit({
        store,
        get,
        getMetadata,
        event: input.event,
        now: () => ts,
        createEventId: () => "accepted-event",
      }),
  });
  const source = await exported(store);
  const record = await store.get(await store.snapshot(), "events", "accepted-event");
  const authorityEvents = [
    {
      eventId: record.eventId,
      envelope: record.envelope,
      committedAt: record.committedAt,
      deliveries: {},
    },
  ];
  const destination = path.join(path.dirname(sessionDir), "migrated");
  await initializeImmutableSession({
    sessionDir: destination,
    session: source,
    operationId: "import",
    authorityEvents,
    outbox: authorityEvents,
  });
  const migrated = openStore(destination);
  assert.deepEqual(await exported(migrated), source);
  assert.deepEqual(
    await migrated.get(await migrated.snapshot(), "outbox", record.eventId),
    authorityEvents[0],
  );
  const brokenDestination = path.join(path.dirname(sessionDir), "broken");
  await assert.rejects(
    initializeImmutableSession({
      sessionDir: brokenDestination,
      session: source,
      operationId: "import",
    }),
    { code: "AUTHORITY_OUTBOX_INTEGRITY_INVALID" },
  );
  await assert.rejects(readFile(path.join(brokenDestination, "head.json")), { code: "ENOENT" });
});

test("bulk import flushes multiple segments before publishing a validated head and retries head failure", async (t) => {
  const sessionDir = await fixture(t);
  const source = emptySession();
  source.messages = [
    { ...message("m1", "d1", "t1"), content: randomBytes(3 * 1024 * 1024).toString("hex") },
  ];
  source.dialogOrder = [
    { dialogProcessId: "d1", dialogOrdinal: 1, turnScopeId: "t1", userMessageUid: "m1" },
  ];
  const before = structuredClone(source);
  const headPath = path.join(sessionDir, "head.json");
  const input = {
    sessionDir,
    session: source,
    operationId: "bulk-import",
    objectStore: ImmutableSessionImportStore,
  };
  setFsAdapter({
    rename: async (from, target) => {
      if (target === headPath) throw Object.assign(new Error("head failure"), { code: "EIO" });
      return rename(from, target);
    },
  });
  try {
    await assert.rejects(initializeImmutableSession(input), { code: "SESSION_COMMIT_UNCERTAIN" });
  } finally {
    resetFsAdapter();
  }
  await assert.rejects(readFile(headPath), { code: "ENOENT" });
  assert.ok((await readdir(path.join(sessionDir, "segments"))).length > 1);
  const result = await initializeImmutableSession(input);
  assert.deepEqual(await exported(openStore(sessionDir)), normalizeSessionEntity(source));
  assert.deepEqual(await initializeImmutableSession(input), { ...result, replayed: true });
  assert.deepEqual(source, before);
});
