/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { listSnapshotRetentionFiles } from "../helpers/partition-journal-cases.js";
import {
  createMessageCase,
  openTestMessages,
  prepare,
} from "./partition-session-messages.test-helpers.js";

const options = (journal, sessionId) => ({ journal, sessionId, parentSessionId: "" });

test("an independently retained reader pins its generation until close", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const messages = openTestMessages(journal, sessionId);
  const reader = await openPartitionSessionReader(options(journal, sessionId));
  t.after(() => reader.close());
  const original = await reader.readMetadata();
  assert.equal((await listSnapshotRetentionFiles(journal)).length, 1);
  await messages.commit(
    await prepare(journal, messages, "rename", {
      sessionMetadata: { customTitle: "published title" },
    }),
  );
  assert.deepEqual(await reader.readMetadata(), original);
  await using current = await openPartitionSessionReader(options(journal, sessionId));
  assert.ok(current.generation > reader.generation);
  assert.equal((await current.readMetadata()).customTitle, "published title");
  await reader.close();
  await reader.close();
  await assert.rejects(reader.readMetadata(), { code: "SESSION_READER_CLOSED" });
  await current.close();
  assert.deepEqual(await listSnapshotRetentionFiles(journal), []);
});

test("reader close drains an active snapshot read before releasing retention", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const reader = await openPartitionSessionReader(options(journal, sessionId));
  t.after(() => reader.close());
  const original = journal.withSnapshot.bind(journal);
  const entered = Promise.withResolvers();
  const unblock = Promise.withResolvers();
  journal.withSnapshot = (snapshot, operation) =>
    original(snapshot, async () => {
      entered.resolve();
      await unblock.promise;
      return operation();
    });
  const reading = reader.readMetadata();
  await entered.promise;
  let closed = false;
  const closing = reader.close().then(() => {
    closed = true;
  });
  await assert.rejects(reader.readMetadata(), { code: "SESSION_READER_CLOSED" });
  assert.equal(closed, false);
  assert.equal((await listSnapshotRetentionFiles(journal)).length, 1);
  unblock.resolve();
  assert.equal((await reading).sessionId, sessionId);
  await closing;
  assert.deepEqual(await listSnapshotRetentionFiles(journal), []);
});

test("reader close reports failed retention release and permits explicit retry", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const reader = await openPartitionSessionReader(options(journal, sessionId));
  const original = journal.releaseSnapshot.bind(journal);
  const failure = new Error("retention publication failed");
  journal.releaseSnapshot = async () => {
    throw failure;
  };
  await assert.rejects(reader.close(), (error) => {
    assert.equal(error.code, "SESSION_SNAPSHOT_RELEASE_UNCERTAIN");
    assert.equal(error.cause, failure);
    return true;
  });
  assert.equal((await listSnapshotRetentionFiles(journal)).length, 1);
  await assert.rejects(reader.readMetadata(), { code: "SESSION_READER_CLOSED" });
  journal.releaseSnapshot = original;
  await reader.close();
  assert.deepEqual(await listSnapshotRetentionFiles(journal), []);
});

test("reader acquisition cleans an uncertain retained snapshot before reporting the error", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const original = journal.snapshot.bind(journal);
  const failure = new Error("snapshot publication uncertain");
  journal.snapshot = async () => {
    throw Object.assign(failure, {
      code: "SESSION_SNAPSHOT_UNCERTAIN",
      snapshot: await original(),
    });
  };
  await assert.rejects(
    openPartitionSessionReader(options(journal, sessionId)),
    (e) => e === failure,
  );
  assert.deepEqual(await listSnapshotRetentionFiles(journal), []);
});

test("failed scope validation and cleanup preserve both errors and the recovery snapshot", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const original = journal.releaseSnapshot.bind(journal);
  const failure = new Error("retention cleanup failed");
  journal.releaseSnapshot = async () => {
    throw failure;
  };
  let recoverySnapshot;
  await assert.rejects(
    openPartitionSessionReader({ ...options(journal, sessionId), parentSessionId: "foreign" }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors[0].code, "SESSION_SCOPE_IDENTITY_CONFLICT");
      assert.equal(error.errors[1].code, "SESSION_SNAPSHOT_RELEASE_UNCERTAIN");
      assert.equal(error.errors[1].cause, failure);
      recoverySnapshot = error.errors[1].snapshot;
      return true;
    },
  );
  journal.releaseSnapshot = original;
  await journal.releaseSnapshot(recoverySnapshot);
  assert.deepEqual(await listSnapshotRetentionFiles(journal), []);
});
