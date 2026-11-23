/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { PartitionJournalOwner } from "../../src/session/partition-storage/partition-journal-owner.js";
import { createPartitionSessionReaderAccess } from "../../src/session/partition-storage/partition-reader-access.js";
import { journalTestLimits } from "../helpers/partition-journal-cases.js";
import { journalPartitionPath } from "../../src/session/partition-storage/journal-io.js";
import { emptyPartitionSession } from "../helpers/partition-session-cases.js";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "partition-removal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const owner = new PartitionJournalOwner({
    durableAncestor: root,
    limits: journalTestLimits(),
    maxJournals: 1,
  });
  t.after(() => owner.close());
  const scope = { sessionDir: join(root, "session"), sessionId: "original", parentSessionId: "" };
  const access = createPartitionSessionReaderAccess({
    acquireJournal: owner.acquire.bind(owner),
    withJournalRemoval: owner.withRemoval.bind(owner),
  });
  const create = (sessionId) =>
    access.create(
      { ...scope, sessionId },
      {
        operationId: "create",
        scopedMetadata: null,
        session: emptyPartitionSession({
          sessionId,
          parentSessionId: "",
          committedAt: "2026-11-20T00:00:00.000Z",
        }),
      },
    );
  await create(scope.sessionId);
  return { owner, scope, access, create, staged: join(root, "removed") };
}

test("directory removal rejects a live journal lease even without a retained reader", async (t) => {
  const { owner, scope, access, staged } = await fixture(t);
  await using lease = await owner.acquire(scope);
  let removed = false;
  await assert.rejects(
    access.withRemoval(scope, async () => {
      removed = true;
      await rename(scope.sessionDir, staged);
    }),
    { code: "SESSION_MUTATION_BUSY" },
  );
  assert.equal(removed, false);
  assert.equal(lease.journal.closed, false);
});

test("directory removal retires the resident identity before its path is reused", async (t) => {
  const { owner, scope, access, create, staged } = await fixture(t);
  const original = owner.entries.get(scope.sessionDir).journal;
  await access.withRemoval(scope, () => rename(scope.sessionDir, staged));
  await create("replacement");
  assert.equal(original.closed, true);
  await using reader = await access.open({ ...scope, sessionId: "replacement" });
  assert.equal((await reader.readMetadata()).sessionId, "replacement");
  assert.notEqual(owner.entries.get(scope.sessionDir).journal.head.epoch, original.head.epoch);
});

test("authorized removal does not decode a damaged resident journal head", async (t) => {
  const { owner, scope, access, staged } = await fixture(t);
  await writeFile(join(scope.sessionDir, "CURRENT"), "damaged");
  await access.withRemoval(scope, () => rename(scope.sessionDir, staged));
  assert.equal(owner.entries.size, 0);
});

test("partition access rejects a missing removal dependency at construction", () => {
  assert.throws(() => createPartitionSessionReaderAccess({ acquireJournal() {} }), TypeError);
});

test("queued transactions block removal after their caller releases its lease", async (t) => {
  const { owner, scope, access, staged } = await fixture(t);
  const { journal } = owner.entries.get(scope.sessionDir);
  const drain = t.mock.method(journal, "startDrain", () => Promise.resolve());
  const pending = journal.appendTransaction(
    {
      epoch: journal.head.epoch,
      sequence: journal.head.sequence + 1,
      operationId: "queued",
    },
    {
      validateScope: async () => {},
      prepare: async () => ({ action: "abort", result: null }),
    },
  );
  try {
    await assert.rejects(
      access.withRemoval(scope, () => rename(scope.sessionDir, staged)),
      {
        code: "SESSION_MUTATION_BUSY",
      },
    );
    assert.equal(journal.closed, false);
    assert.equal(journal.queue.length, 1);
  } finally {
    drain.mock.restore();
    await journal.startDrain();
    await pending;
  }
  await access.withRemoval(scope, () => rename(scope.sessionDir, staged));
});

test("new journal admission waits until directory removal finishes", async (t) => {
  const { scope, access, create, staged } = await fixture(t);
  const entered = Promise.withResolvers();
  const blocked = Promise.withResolvers();
  const removal = access.withRemoval(scope, async () => {
    entered.resolve();
    await blocked.promise;
    await rename(scope.sessionDir, staged);
  });
  await entered.promise;
  const creation = create("replacement");
  try {
    assert.equal(
      await Promise.race([creation, new Promise((resolve) => setImmediate(resolve, null))]),
      null,
    );
  } finally {
    blocked.resolve();
    await removal;
  }
  await creation;
  await using reader = await access.open({ ...scope, sessionId: "replacement" });
  assert.equal((await reader.readMetadata()).sessionId, "replacement");
});

test("a failed rename leaves cold authoritative access and deletion retry available", async (t) => {
  const { owner, scope, access, staged } = await fixture(t);
  const original = owner.entries.get(scope.sessionDir).journal;
  const failure = Object.assign(new Error("rename unavailable"), { code: "EIO" });
  await assert.rejects(
    access.withRemoval(scope, async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(owner.entries.size, 0);
  assert.equal(original.closed, true);
  await using reader = await access.open(scope);
  assert.equal((await reader.readMetadata()).sessionId, scope.sessionId);
  await reader.close();
  await access.withRemoval(scope, () => rename(scope.sessionDir, staged));
});

async function handOffFailedSnapshotRelease(t, { owner, scope, access }) {
  const entry = owner.entries.get(scope.sessionDir);
  const reader = await access.open(scope);
  const releaseFailure = new Error("snapshot release interrupted");
  const fault = t.mock.method(entry.journal, "releaseSnapshot", async () => {
    throw releaseFailure;
  });
  try {
    await assert.rejects(reader[Symbol.asyncDispose](), {
      code: "SESSION_SNAPSHOT_RELEASE_UNCERTAIN",
      cause: releaseFailure,
    });
    assert.equal(entry.users, 0);
  } finally {
    fault.mock.restore();
  }
}

test("directory removal relinquishes a disposed reader's snapshot without decoding a damaged head", async (t) => {
  const state = await fixture(t);
  const { owner, scope, access, staged } = state;
  await handOffFailedSnapshotRelease(t, state);
  await writeFile(join(scope.sessionDir, "CURRENT"), "damaged");
  await access.withRemoval(scope, () => rename(scope.sessionDir, staged));
  assert.equal(owner.entries.size, 0);
});

test("cold reopen recovers a relinquished retention after the removal rename fails", async (t) => {
  const state = await fixture(t);
  const { scope, access, staged } = state;
  await handOffFailedSnapshotRelease(t, state);
  const failure = new Error("rename unavailable");
  await assert.rejects(
    access.withRemoval(scope, async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  await using reader = await access.open(scope);
  assert.equal((await reader.readMetadata()).sessionId, scope.sessionId);
  await reader.close();
  await access.withRemoval(scope, () => rename(scope.sessionDir, staged));
});

test("failed corrupt-journal retirement cannot prevent authorized deletion", async (t) => {
  const { owner, scope, access, staged } = await fixture(t);
  await rm(journalPartitionPath(scope.sessionDir, 0));
  await assert.rejects(access.open(scope), { code: "SESSION_STORAGE_CORRUPT" });
  await assert.rejects(owner.releaseWorkspace(dirname(scope.sessionDir)), AggregateError);
  await access.withRemoval(scope, () => rename(scope.sessionDir, staged));
  assert.equal(owner.entries.size, 0);
});
