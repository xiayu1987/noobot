/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { partitionEpochHexLength } from "../src/partition-epoch.js";
import {
  PARTITION_MIGRATION_AUTHORITY,
  PARTITION_MIGRATION_BUSINESS_CHECKPOINT,
  assertPartitionMigrationBusinessCheckpointTarget,
  createSessionReaderAccess,
  decodePartitionMigrationAuthority,
  decodePartitionMigrationBusinessCheckpoint,
  encodePartitionMigrationAuthority,
  encodePartitionMigrationBusinessCheckpoint,
  planSessionOutboxMutation,
  readPartitionAuthorityPublication,
  requirePartitionSessionAuthority,
} from "../src/session-reader.js";

const source = {
  sessionId: "session",
  format: "noobot.immutable-session/5",
  generation: 4,
  commit: "a".repeat(64),
};
const target = {
  sessionId: source.sessionId,
  epoch: "b".repeat(partitionEpochHexLength),
  generation: 2,
};
const immutableFacts = { partition: false, immutable: true, document: true };
const corrupt = { code: "SESSION_STORAGE_CORRUPT" };

test("publication selects the bound partition authority without reopening the retained source", () => {
  const migration = encodePartitionMigrationAuthority({ source, target });
  assert.deepEqual(decodePartitionMigrationAuthority(migration), {
    format: PARTITION_MIGRATION_AUTHORITY.format,
    source,
    target,
  });
  assert.throws(() => requirePartitionSessionAuthority(immutableFacts), {
    code: "SESSION_STORAGE_FORMAT_UNSUPPORTED",
  });
  assert.equal(requirePartitionSessionAuthority({ ...immutableFacts, migration }), true);
  for (const facts of [
    { ...immutableFacts, partition: true },
    { partition: true, immutable: false, document: false, migration },
  ]) {
    assert.throws(() => requirePartitionSessionAuthority(facts), corrupt);
  }
});

test("invalid publication bytes never fall back to the retained source", () => {
  const record = { format: PARTITION_MIGRATION_AUTHORITY.format, source, target };
  const valid = encodePartitionMigrationAuthority({ source, target });
  const oversized = Buffer.concat([
    valid,
    Buffer.alloc(PARTITION_MIGRATION_AUTHORITY.maxBytes, 32),
  ]);
  for (const migration of [
    Buffer.from(PARTITION_MIGRATION_AUTHORITY.directory),
    Buffer.alloc(0),
    Buffer.from([0xff]),
    valid.subarray(0, valid.length - 1),
    oversized,
    ...[
      { ...record, extra: true },
      { ...record, source: { ...source, commit: "invalid" } },
      { ...record, target: { ...target, sessionId: "foreign" } },
      { ...record, target: { ...target, epoch: "invalid" } },
      { ...record, target: { ...target, generation: "2" } },
      { ...record, target: { ...target, generation: 0 } },
    ].map((value) => Buffer.from(JSON.stringify(value))),
  ]) {
    const facts = { ...immutableFacts, migration };
    assert.throws(() => requirePartitionSessionAuthority(facts), corrupt);
  }
});

test("a migration target can advance but cannot change identity or regress below publication", async () => {
  const migration = encodePartitionMigrationAuthority({ source, target });
  const head = { sessionId: target.sessionId, epoch: target.epoch, sequence: target.generation };
  const readPublication = (currentHead) =>
    readPartitionAuthorityPublication(migration, async (directory) => {
      assert.deepEqual(directory, [PARTITION_MIGRATION_AUTHORITY.directory]);
      return currentHead;
    });
  for (const currentHead of [head, { ...head, sequence: head.sequence + 1 }]) {
    assert.deepEqual(await readPublication(currentHead), {
      head: currentHead,
      receipt: { source, target },
    });
  }
  for (const mismatch of [
    { sessionId: "foreign" },
    { epoch: "c".repeat(partitionEpochHexLength) },
    { sequence: head.sequence - 1 },
  ])
    await assert.rejects(readPublication({ ...head, ...mismatch }), corrupt);
});

test("the business checkpoint binds a committed prefix but cannot select authority", () => {
  const bytes = encodePartitionMigrationBusinessCheckpoint({ source, target });
  const checkpoint = decodePartitionMigrationBusinessCheckpoint(bytes);
  assert.deepEqual(checkpoint, {
    format: PARTITION_MIGRATION_BUSINESS_CHECKPOINT.format,
    source,
    target,
  });
  assert.throws(
    () => requirePartitionSessionAuthority({ ...immutableFacts, migration: bytes }),
    corrupt,
  );
  assert.throws(
    () =>
      decodePartitionMigrationBusinessCheckpoint(
        encodePartitionMigrationAuthority({ source, target }),
      ),
    corrupt,
  );
  const head = { sessionId: target.sessionId, epoch: target.epoch, sequence: target.generation };
  assertPartitionMigrationBusinessCheckpointTarget(checkpoint, {
    ...head,
    sequence: head.sequence + 1,
  });
  for (const mismatch of [
    { sessionId: "foreign" },
    { epoch: "c".repeat(partitionEpochHexLength) },
    { sequence: head.sequence - 1 },
  ])
    assert.throws(
      () => assertPartitionMigrationBusinessCheckpointTarget(checkpoint, { ...head, ...mismatch }),
      corrupt,
    );
});

test("reader access projects authoritative placement without exposing other metadata", async () => {
  const operations = {
    create() {},
    open() {},
    openArtifact() {},
    withCommit() {},
    withOutboxMutation() {},
    withMutation() {},
    withRemoval() {},
    recover() {},
  };
  assert.throws(() => createSessionReaderAccess(operations), TypeError);
  const scope = { sessionDir: "/session", sessionId: "session" };
  const access = createSessionReaderAccess({
    ...operations,
    async readPlacement(input) {
      assert.equal(input, scope);
      return {
        sessionId: "session",
        parentSessionId: "parent",
        caller: SESSION_CALLER.USER,
        messages: ["private"],
      };
    },
  });
  assert.deepEqual(await access.readPlacement(scope), {
    sessionId: "session",
    parentSessionId: "parent",
    caller: SESSION_CALLER.USER,
  });
  const absent = createSessionReaderAccess({ ...operations, readPlacement: async () => null });
  assert.equal(await absent.readPlacement(scope), null);
  const wrong = createSessionReaderAccess({
    ...operations,
    readPlacement: async () => ({ sessionId: "foreign", parentSessionId: "parent" }),
  });
  await assert.rejects(wrong.readPlacement(scope), { code: "SESSION_SCOPE_IDENTITY_CONFLICT" });
  const wrongParent = createSessionReaderAccess({
    ...operations,
    readPlacement: async () => ({
      sessionId: "session",
      parentSessionId: "stored-parent",
      caller: SESSION_CALLER.USER,
    }),
  });
  await assert.rejects(
    wrongParent.readPlacement({ ...scope, parentSessionId: "requested-parent" }),
    { code: "SESSION_SCOPE_IDENTITY_CONFLICT" },
  );
  await assert.rejects(wrongParent.readPlacement({ ...scope, parentSessionId: null }), {
    code: "SESSION_SCOPE_IDENTITY_CONFLICT",
  });
  const missingCaller = createSessionReaderAccess({
    ...operations,
    readPlacement: async () => ({ sessionId: "session", parentSessionId: "parent" }),
  });
  await assert.rejects(missingCaller.readPlacement(scope), { code: "SESSION_STORAGE_CORRUPT" });
  const failure = new Error("storage failed");
  const damaged = createSessionReaderAccess({
    ...operations,
    readPlacement: async () => {
      throw failure;
    },
  });
  await assert.rejects(damaged.readPlacement(scope), (error) => error === failure);
});

test("reader access requires recovery and preserves its reader ownership and errors", async () => {
  const reader = { close() {} };
  const failure = new Error("recovery failed");
  const operations = {
    create() {},
    open() {},
    openArtifact() {},
    withCommit() {},
    withOutboxMutation() {},
    withMutation() {},
    withRemoval() {},
    readPlacement() {},
    async recover(scope) {
      if (scope === "absent") return null;
      if (scope === "damaged") throw failure;
      return reader;
    },
  };
  for (const name of Object.keys(operations)) {
    const incomplete = { ...operations };
    delete incomplete[name];
    assert.throws(() => createSessionReaderAccess(incomplete), TypeError);
  }
  const access = createSessionReaderAccess(operations);
  assert.equal(await access.recover("present"), reader);
  assert.equal(await access.recover("absent"), null);
  await assert.rejects(access.recover("damaged"), (error) => error === failure);
});

test("creation preserves its atomic input and outcome without opening a reader", async () => {
  const scope = { sessionId: "session", parentSessionId: "parent", sessionDir: "/session" };
  const initialization = {
    session: { sessionId: "session", parentSessionId: "parent" },
    operationId: "create",
    authorityEvents: [{ eventId: "first-event" }],
    scopedMetadata: { workspace: { label: "initial" } },
  };
  const outcome = { generation: 1, result: { accepted: true } };
  let calls = 0;
  const access = createSessionReaderAccess({
    create(actualScope, actualInput) {
      calls += 1;
      assert.equal(actualScope, scope);
      assert.equal(actualInput, initialization);
      return outcome;
    },
    open() {
      assert.fail("creation must not open a reader");
    },
    openArtifact() {
      assert.fail("creation must not open an artifact reader");
    },
    withCommit() {
      assert.fail("creation must not publish a second transaction");
    },
    withOutboxMutation() {
      assert.fail("creation must not mutate the outbox separately");
    },
    withMutation() {
      assert.fail("creation must not publish a second transaction");
    },
    withRemoval() {},
    readPlacement() {
      assert.fail("creation must not infer placement");
    },
    recover() {
      assert.fail("creation must not infer recovery");
    },
  });
  assert.equal(await access.create(scope, initialization), outcome);
  assert.equal(calls, 1);
  for (const field of ["sessionId", "parentSessionId"])
    await assert.rejects(
      access.create(scope, {
        ...initialization,
        session: { ...initialization.session, [field]: "foreign" },
      }),
      { code: "SESSION_SCOPE_IDENTITY_CONFLICT" },
    );
  assert.equal(calls, 1);
});

test("creation propagates uncertain durability without retrying or recovering", async () => {
  const failure = Object.assign(new Error("uncertain creation"), {
    code: "SESSION_COMMIT_UNCERTAIN",
  });
  let calls = 0;
  const access = createSessionReaderAccess({
    create() {
      calls += 1;
      throw failure;
    },
    open() {
      assert.fail("uncertain creation must not open a reader");
    },
    openArtifact() {},
    withCommit() {},
    withOutboxMutation() {},
    withMutation() {},
    withRemoval() {},
    readPlacement() {},
    recover() {
      assert.fail("uncertain creation must not recover implicitly");
    },
  });
  const scope = { sessionId: "session", parentSessionId: "" };
  await assert.rejects(access.create(scope, { session: scope }), (error) => error === failure);
  assert.equal(calls, 1);
});

test("outbox completion is handed off only after the planning reader closes", async () => {
  let reads = 0;
  const publication = {
    generation: 4,
    methods: { readOutboxPage: () => ++reads },
  };
  const complete = await planSessionOutboxMutation(publication, async (reader) => {
    assert.equal(reader.generation, 4);
    assert.equal(await reader.readOutboxPage(), 1);
    return async (commit) => {
      await assert.rejects(async () => reader.readOutboxPage(), { code: "SESSION_READER_CLOSED" });
      return commit(reader.generation);
    };
  });
  assert.equal(await complete((generation) => generation), 4);
  assert.equal(reads, 1);
  await assert.rejects(
    planSessionOutboxMutation(publication, () => null),
    TypeError,
  );
});
