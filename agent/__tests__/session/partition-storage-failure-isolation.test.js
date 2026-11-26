/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { filePath as path } from "@noobot/path-resolver";
import {
  PARTITION_JOURNAL_FRAME,
  createPartitionJournalReference,
} from "@noobot/session-protocol/partition-journal";
import {
  CommittedJournalDamage,
  journalPartitionPath,
} from "../../src/session/partition-storage/journal-io.js";
import { journalOffsetsPath } from "../../src/session/partition-storage/journal-offsets.js";
import { journalDirectoryPath } from "../../src/session/partition-storage/journal-directory.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { entityDirectoryPath } from "../../src/session/partition-storage/entity-directory-io.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  commitFixtureTransaction,
  createJournalCase,
  createTransactionCase,
  journalRequest,
  wrapHandle,
} from "../helpers/partition-journal-cases.js";

function failClose(file, failure) {
  const previous = getFsAdapter();
  setFsAdapter({
    ...previous,
    async open(target, ...args) {
      const handle = await previous.open(target, ...args);
      if (String(target) !== file) return handle;
      return wrapHandle(handle, {
        async close() {
          await handle.close();
          throw failure;
        },
      });
    },
  });
  return () => setFsAdapter(previous);
}

const readers = {
  page: (journal, snapshot) =>
    journal.readPage({ snapshot, cursor: { partition: 0, offset: 0, sequence: 0 } }),
  sequence: (journal, snapshot) => journal.readSequenceRecord({ snapshot, sequence: 1 }),
  sequencePage: (journal, snapshot) => journal.readSequencePage({ snapshot, sequence: 1 }),
  partitionPage: (journal, snapshot) =>
    journal.readPartitionPage({
      snapshot,
      cursor: { partition: 0, offset: 0, sequence: 0 },
    }),
  record: (journal, snapshot) =>
    journal.readRecord({
      snapshot,
      reference: createPartitionJournalReference(snapshot, {
        cursor: { partition: 0 },
        sequence: 1,
      }),
    }),
  sharedRecord: (journal, snapshot) =>
    journal.withRecordReader(snapshot, () => readers.record(journal, snapshot)),
};

for (const [name, read] of Object.entries(readers)) {
  test(`${name} preserves committed damage and close failure and fences later writes`, async (t) => {
    const { journal, root } = await createJournalCase(t, {}, { autoClose: false });
    await journal.append(journalRequest(journal, 1));
    const snapshot = await journal.snapshot();
    const body = journalPartitionPath(root, 0);
    const bytes = await readFile(body);
    bytes[PARTITION_JOURNAL_FRAME.headerBytes] ^= 1;
    await writeFile(body, bytes);
    const current = await readFile(`${root}/CURRENT`);
    const closeFailure = new Error("injected body close failure");
    const restore = failClose(body, closeFailure);
    let failure;
    try {
      await assert.rejects(read(journal, snapshot), (error) => {
        failure = error;
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors[0].code, "SESSION_STORAGE_CORRUPT");
        assert.equal(error.errors[1], closeFailure);
        return true;
      });
    } finally {
      restore();
      await journal.releaseSnapshot(snapshot);
    }
    assert.equal(journal.failure, failure);
    await assert.rejects(journal.append(journalRequest(journal, 2)), (error) => error === failure);
    assert.deepEqual(await readFile(`${root}/CURRENT`), current);
    await assert.rejects(journal.close(), (error) => error === failure);
  });
}

for (const [name, filePath] of [
  ["sealed directory", journalDirectoryPath],
  ["offset index", journalOffsetsPath],
]) {
  test(`${name} damage and close failure preserve both causes and fence writes`, async (t) => {
    const { journal, root } = await createJournalCase(
      t,
      { partitionRecords: 1 },
      { autoClose: false },
    );
    await journal.append(journalRequest(journal, 1));
    await journal.append(journalRequest(journal, 2));
    const snapshot = await journal.snapshot();
    const file = filePath(root, 0);
    const bytes = await readFile(file);
    bytes.fill(0xff);
    await writeFile(file, bytes);
    const before = await readFile(`${root}/CURRENT`);
    const closeFailure = new Error(`injected ${name} close failure`);
    const restore = failClose(file, closeFailure);
    let failure;
    try {
      await assert.rejects(readers.sequence(journal, snapshot), (error) => {
        failure = error;
        assert.ok(error instanceof AggregateError);
        assert.ok(error.errors[0] instanceof CommittedJournalDamage);
        assert.equal(error.errors[1], closeFailure);
        return true;
      });
    } finally {
      restore();
      await journal.releaseSnapshot(snapshot);
    }
    assert.equal(journal.failure, failure);
    await assert.rejects(journal.append(journalRequest(journal, 3)), (error) => error === failure);
    assert.deepEqual(await readFile(`${root}/CURRENT`), before);
    await assert.rejects(journal.close(), (error) => error === failure);
  });
}

test("cold entity directory damage and close failure fence collection transactions", async (t) => {
  const fixture = await createTransactionCase(t);
  const request = (sequence) => ({
    epoch: fixture.journal.head.epoch,
    sequence,
    expectedGeneration: sequence - 1,
    operationId: `entity-operation-${sequence}`,
    input: { sequence },
    mutations: [{ collection: "messages", key: `m${sequence}`, owner: null, value: sequence }],
    result: null,
  });
  await commitFixtureTransaction(new PartitionTransactions(fixture.journal), request(1));
  await fixture.journal.close();
  const journal = await PartitionJournal.open({ root: fixture.root, sessionId: fixture.sessionId });
  const transactions = new PartitionTransactions(journal);
  const snapshot = await journal.snapshot();
  const { position } = snapshot.entityDirectory.identities;
  const file = entityDirectoryPath(fixture.root, position.segment);
  const bytes = await readFile(file);
  bytes[position.offset] = 0xff;
  await writeFile(file, bytes);
  const before = await readFile(`${fixture.root}/CURRENT`);
  const closeFailure = new Error("injected entity directory close failure");
  const restore = failClose(file, closeFailure);
  let failure;
  try {
    await assert.rejects(
      transactions.getLatestMany({ snapshot, collection: "messages", keys: ["m1"] }),
      (error) => {
        failure = error;
        assert.ok(error instanceof AggregateError);
        assert.ok(error.errors[0] instanceof CommittedJournalDamage);
        assert.equal(error.errors[1], closeFailure);
        return true;
      },
    );
  } finally {
    restore();
    await journal.releaseSnapshot(snapshot);
  }
  assert.equal(journal.failure, failure);
  await assert.rejects(
    commitFixtureTransaction(transactions, request(2)),
    (error) => error === failure,
  );
  assert.deepEqual(await readFile(`${fixture.root}/CURRENT`), before);
  await assert.rejects(journal.close(), (error) => error === failure);
});

test("control decoding failure survives simultaneous descriptor close failure", async (t) => {
  const { journal, root } = await createJournalCase(t, {}, { autoClose: false });
  const control = path.join(root, "CURRENT");
  await writeFile(control, "invalid control");
  const closeFailure = new Error("injected control close failure");
  const restore = failClose(control, closeFailure);
  let failure;
  try {
    await assert.rejects(journal.snapshot(), (error) => {
      failure = error;
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors[0].code, "SESSION_STORAGE_CORRUPT");
      assert.equal(error.errors[1], closeFailure);
      return true;
    });
  } finally {
    restore();
  }
  assert.equal(journal.failure, failure);
  await assert.rejects(journal.close(), (error) => error === failure);
});

test("a close failure without committed damage does not label the journal corrupt", async (t) => {
  const { journal, root } = await createJournalCase(t);
  await journal.append(journalRequest(journal, 1));
  const snapshot = await journal.snapshot();
  const closeFailure = new Error("injected close failure only");
  const restore = failClose(journalPartitionPath(root, 0), closeFailure);
  try {
    await assert.rejects(readers.page(journal, snapshot), (error) => error === closeFailure);
  } finally {
    restore();
    await journal.releaseSnapshot(snapshot);
  }
  assert.equal(journal.failure, null);
  assert.equal((await journal.append(journalRequest(journal, 2))).sequence, 2);
});

test("callback errors do not impersonate committed journal damage", async (t) => {
  const { journal } = await createJournalCase(t);
  const failure = Object.assign(new Error("business read failed"), {
    code: "SESSION_STORAGE_CORRUPT",
  });
  failure.cause = failure;
  const aggregate = new AggregateError([failure], "callback aggregate", { cause: failure });
  await assert.rejects(
    journal.usingSnapshot(() => {
      throw aggregate;
    }),
    (error) => error === aggregate,
  );
  assert.equal(journal.failure, null);
  assert.equal((await journal.append(journalRequest(journal, 1))).sequence, 1);
});

test("a distinct later read failure does not replace the first committed damage", async (t) => {
  const { journal } = await createJournalCase(t, {}, { autoClose: false });
  const first = new CommittedJournalDamage("first damage");
  const later = new AggregateError([new CommittedJournalDamage("later damage")]);
  for (const failure of [first, later]) {
    await assert.rejects(
      journal.usingSnapshot(() => {
        throw failure;
      }),
      (error) => error === failure,
    );
    assert.equal(journal.failure, first);
  }
  await assert.rejects(journal.append(journalRequest(journal, 1)), (error) => error === first);
  await assert.rejects(journal.close(), (error) => error === first);
});

for (const [name, filePath] of [
  ["frames", journalPartitionPath],
  ["offsets", journalOffsetsPath],
]) {
  test(`${name} write and close failures retain both causes and recover by identical retry`, async (t) => {
    const { journal, root, sessionId } = await createJournalCase(t, {}, { autoClose: false });
    await journal.append(journalRequest(journal, 1));
    const before = await readFile(`${root}/CURRENT`);
    const request = journalRequest(journal, 2);
    const writeFailure = new Error("injected extent write failure");
    const closeFailure = new Error("injected extent close failure");
    const previous = getFsAdapter();
    setFsAdapter({
      ...previous,
      async open(target, flags, ...args) {
        const handle = await previous.open(target, flags, ...args);
        if (String(target) !== filePath(root, 0) || flags !== "r+") return handle;
        return wrapHandle(handle, {
          async write() {
            throw writeFailure;
          },
          async close() {
            await handle.close();
            throw closeFailure;
          },
        });
      },
    });
    let failure;
    try {
      await assert.rejects(journal.append(request), (error) => {
        failure = error;
        assert.equal(error.code, "SESSION_COMMIT_UNCERTAIN");
        assert.ok(error.cause instanceof AggregateError);
        assert.deepEqual(error.cause.errors, [writeFailure, closeFailure]);
        return true;
      });
    } finally {
      setFsAdapter(previous);
    }
    assert.equal(journal.failure, failure);
    assert.deepEqual(await readFile(`${root}/CURRENT`), before);
    await assert.rejects(journal.close(), (error) => error === failure);
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const result = await reopened.append(request);
    assert.equal(result.sequence, 2);
    assert.equal(result.replayed, false);
    assert.equal((await reopened.append(request)).replayed, true);
  });
}
