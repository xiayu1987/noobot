/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { withPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { listSnapshotRetentionFiles } from "../helpers/partition-journal-cases.js";
import { committedAt, createMessageCase } from "./partition-session-messages.test-helpers.js";

const command = (operationId, customTitle) => ({
  operationId,
  committedAt,
  changes: { sessionMetadata: { customTitle } },
});
const options = (journal, sessionId) => ({ journal, sessionId, parentSessionId: "" });

test("scoped commits preserve the initial snapshot and read-current sees durable writes without rebasing", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  let escaped;
  await withPartitionSessionReader(
    options(journal, sessionId),
    async (reader, commit, readCurrent) => {
      escaped = { reader, commit, readCurrent };
      const original = await reader.readMetadata();
      const request = await reader.prepareRequest(command("first", "first title"));
      const committed = await commit(request);
      assert.deepEqual(await commit(request), { ...committed, replayed: true });
      assert.deepEqual(await reader.readMetadata(), original);
      const stale = await reader.prepareRequest(command("stale", "must not publish"));
      await assert.rejects(commit(stale), { code: "SESSION_OPERATION_CONFLICT" });
      await readCurrent(async (current) => {
        escaped.current = current;
        assert.equal(current.generation, committed.generation);
        assert.equal((await current.readMetadata()).customTitle, "first title");
        assert.equal((await listSnapshotRetentionFiles(journal)).length, 2);
        const next = await current.prepareRequest(command("second", "second title"));
        await commit(next);
        assert.equal((await current.readMetadata()).customTitle, "first title");
      });
      await assert.rejects(escaped.current.readMetadata(), { code: "SESSION_READER_CLOSED" });
      assert.equal((await listSnapshotRetentionFiles(journal)).length, 1);
      assert.equal(
        await readCurrent(async (current) => (await current.readMetadata()).customTitle),
        "second title",
      );
    },
  );
  await assert.rejects(escaped.commit({}), { code: "SESSION_READER_CLOSED" });
  await assert.rejects(
    escaped.readCurrent(() => {}),
    { code: "SESSION_READER_CLOSED" },
  );
  await assert.rejects(escaped.reader.readMetadata(), { code: "SESSION_READER_CLOSED" });
  assert.deepEqual(await listSnapshotRetentionFiles(journal), []);
});

test("scoped transaction captures scope before callbacks can mutate their options", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const input = options(journal, sessionId);
  await withPartitionSessionReader(input, async (reader, commit, readCurrent) => {
    input.parentSessionId = "foreign";
    input.sessionId = "foreign";
    input.journal = null;
    await commit(await reader.prepareRequest(command("captured-scope", "captured")));
    assert.equal(
      await readCurrent(async (current) => (await current.readMetadata()).customTitle),
      "captured",
    );
  });
  assert.deepEqual(await listSnapshotRetentionFiles(journal), []);
});

test("scope exit drains admitted commits before releasing its initial snapshot", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const original = journal.appendTransaction.bind(journal);
  const entered = Promise.withResolvers();
  const unblock = Promise.withResolvers();
  journal.appendTransaction = async (...args) => {
    entered.resolve();
    await unblock.promise;
    return original(...args);
  };
  let pending;
  let escapedCommit;
  let finished = false;
  const scoped = withPartitionSessionReader(options(journal, sessionId), async (reader, commit) => {
    escapedCommit = commit;
    pending = commit(await reader.prepareRequest(command("drained", "durable")));
  }).then(() => {
    finished = true;
  });
  await entered.promise;
  await new Promise(setImmediate);
  try {
    assert.equal(finished, false);
    await assert.rejects(escapedCommit({}), { code: "SESSION_READER_CLOSED" });
    assert.equal((await listSnapshotRetentionFiles(journal)).length, 1);
  } finally {
    unblock.resolve();
  }
  await scoped;
  assert.equal((await pending).status, "committed");
  assert.deepEqual(await listSnapshotRetentionFiles(journal), []);
});

test("scope exit drains read-current callbacks and closes both retained readers after failure", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const entered = Promise.withResolvers();
  const unblock = Promise.withResolvers();
  const failure = new Error("current callback failed");
  let pending;
  let currentReader;
  let finished = false;
  const scoped = withPartitionSessionReader(
    options(journal, sessionId),
    async (_reader, _commit, readCurrent) => {
      pending = assert.rejects(
        readCurrent(async (current) => {
          currentReader = current;
          entered.resolve();
          await unblock.promise;
          throw failure;
        }),
        (error) => error === failure,
      );
    },
  ).then(() => {
    finished = true;
  });
  await entered.promise;
  assert.equal(finished, false);
  assert.equal((await listSnapshotRetentionFiles(journal)).length, 2);
  unblock.resolve();
  await Promise.all([scoped, pending]);
  await assert.rejects(currentReader.readMetadata(), { code: "SESSION_READER_CLOSED" });
  assert.deepEqual(await listSnapshotRetentionFiles(journal), []);
});

test("invalid current callbacks and failed commits do not leak snapshots or publish changes", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const sequence = journal.head.sequence;
  const failure = new Error("outer callback failed");
  await assert.rejects(
    withPartitionSessionReader(options(journal, sessionId), async (reader, commit, readCurrent) => {
      await assert.rejects(readCurrent(null), TypeError);
      const request = await reader.prepareRequest(command("foreign-epoch", "must not publish"));
      await assert.rejects(commit({ ...request, epoch: "foreign" }));
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(journal.head.sequence, sequence);
  assert.deepEqual(await listSnapshotRetentionFiles(journal), []);
});
