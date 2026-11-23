/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { PartitionJournalOwner } from "../../src/session/partition-storage/partition-journal-owner.js";
import { createPartitionSessionReaderAccess } from "../../src/session/partition-storage/partition-reader-access.js";
import { journalPartitionPath } from "../../src/session/partition-storage/journal-io.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  journalTestLimits,
  listSnapshotRetentionFiles,
} from "../helpers/partition-journal-cases.js";
import { emptyPartitionSession } from "../helpers/partition-session-cases.js";

async function fixture(t, maxJournals = 1, close = (owner) => owner.close(), limits = {}) {
  const root = await mkdtemp(join(tmpdir(), "partition-owner-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const owner = new PartitionJournalOwner({
    durableAncestor: root,
    limits: journalTestLimits(limits),
    maxJournals,
  });
  t.after(() => close(owner));
  const scope = (sessionId) => ({
    sessionDir: join(root, sessionId, "session"),
    sessionId,
    parentSessionId: "",
  });
  const access = createPartitionSessionReaderAccess({
    acquireJournal: owner.acquire.bind(owner),
    withJournalRemoval: owner.withRemoval.bind(owner),
  });
  const create = (sessionId) =>
    access.create(scope(sessionId), {
      operationId: "create",
      scopedMetadata: null,
      session: emptyPartitionSession({
        sessionId,
        parentSessionId: "",
        committedAt: "2026-11-20T00:00:00.000Z",
      }),
    });
  return { owner, scope, access, create, root };
}

test("failed open reclaims its snapshot before the next retained read", async (t) => {
  const { owner, scope, access, create } = await fixture(t, 1, undefined, {
    retentionRecords: 1,
  });
  await create("one");
  const session = scope("one");
  const { journal } = owner.entries.get(session.sessionDir);
  const slot = join(session.sessionDir, "retentions", "0.json");
  const adapter = getFsAdapter();
  const failure = Object.assign(new Error("cannot remove retention"), { code: "EIO" });
  setFsAdapter({
    ...adapter,
    async rm(file, ...args) {
      if (String(file) === slot) throw failure;
      return adapter.rm(file, ...args);
    },
  });
  try {
    await assert.rejects(access.open({ ...session, parentSessionId: "foreign" }), (error) => {
      assert.equal(error.errors[0].code, "SESSION_SCOPE_IDENTITY_CONFLICT");
      assert.equal(error.errors[1].cause, failure);
      return true;
    });
    assert.equal((await listSnapshotRetentionFiles(journal)).length, 1);
  } finally {
    setFsAdapter(adapter);
  }
  await using reader = await access.open(session);
  assert.equal((await reader.readMetadata()).sessionId, "one");
  await reader.close();
  assert.deepEqual(await listSnapshotRetentionFiles(journal), []);
});

test("placement does not retain a generation or require a free retention slot", async (t) => {
  const { owner, scope, access, create } = await fixture(t, 1, undefined, { retentionRecords: 1 });
  await create("one");
  const session = scope("one");
  const { journal } = owner.entries.get(session.sessionDir);
  const snapshot = t.mock.method(journal, "snapshot");
  await using reader = await access.open(session);
  assert.equal((await access.readPlacement(session)).sessionId, "one");
  assert.equal(snapshot.mock.callCount(), 1);
  assert.equal((await listSnapshotRetentionFiles(journal)).length, 1);
  await reader.close();
  assert.deepEqual(await listSnapshotRetentionFiles(journal), []);
});

test(
  "outbox planning works with full retentions and releases publication before commit",
  { timeout: 5000 },
  async (t) => {
    const { owner, scope, access, create } = await fixture(t, 1, undefined, {
      retentionRecords: 1,
    });
    await create("one");
    const session = scope("one");
    const { journal } = owner.entries.get(session.sessionDir);
    const snapshot = t.mock.method(journal, "snapshot");
    await using retained = await access.open(session);
    const command = (operationId) => ({
      operationId,
      committedAt: "2026-11-20T00:00:01.000Z",
      changes: { sessionMetadata: { customTitle: operationId } },
    });

    await assert.rejects(
      access.withOutboxMutation({ ...session, parentSessionId: "foreign" }, async (reader) => {
        await reader.readEventSequence("message", "presentation");
        assert.fail("foreign scope must fail during planning");
      }),
      { code: "SESSION_SCOPE_IDENTITY_CONFLICT" },
    );
    await access.withOutboxMutation(session, async (reader) => {
      assert.equal(reader.generation, retained.generation);
      await reader.readOutboxPage({ consumerId: "browser" });
      const request = await reader.prepareRequest(command("outbox-plan"));
      return async (commit) => {
        await assert.rejects(async () => reader.readMetadata(), { code: "SESSION_READER_CLOSED" });
        await journal.withPublicationSnapshot((current) => {
          assert.equal(current.sequence, retained.generation);
        });
        const result = await commit(request);
        assert.equal(result.replayed, false);
        assert.deepEqual(await commit(request), { ...result, replayed: true });
      };
    });
    await assert.rejects(
      access.withOutboxMutation(session, async (reader) => {
        const stale = await reader.prepareRequest(command("stale-plan"));
        return async (commit) => {
          await access.withCommit(session, async ({ prepareRequest, commitChanges }) =>
            commitChanges(await prepareRequest(command("competing-write"))),
          );
          return commit(stale);
        };
      }),
      { code: "SESSION_OPERATION_CONFLICT" },
    );
    assert.equal(snapshot.mock.callCount(), 1);
    assert.equal((await listSnapshotRetentionFiles(journal)).length, 1);
  },
);

test("retirement retains ownership while orphan snapshot cleanup fails and retries the release", async (t) => {
  const { owner, scope, access, create } = await fixture(t);
  await create("one");
  const session = scope("one");
  const workspace = dirname(session.sessionDir);
  const { journal } = owner.entries.get(session.sessionDir);
  const failure = new Error("retention still unavailable");
  const fault = t.mock.method(journal, "releaseSnapshot", async () => {
    throw failure;
  });
  try {
    await assert.rejects(
      access.withMutation(session, async () => {}),
      {
        code: "SESSION_SNAPSHOT_RELEASE_UNCERTAIN",
        cause: failure,
      },
    );
    await assert.rejects(access.open(session), {
      code: "SESSION_SNAPSHOT_RELEASE_UNCERTAIN",
      cause: failure,
    });
    await assert.rejects(owner.releaseWorkspace(workspace), (error) => {
      assert.equal(error.errors[0].cause, failure);
      return true;
    });
    assert.equal(owner.entries.size, 1);
    assert.equal((await listSnapshotRetentionFiles(journal)).length, 1);
  } finally {
    fault.mock.restore();
  }
  await owner.releaseWorkspace(workspace);
  assert.equal(owner.entries.size, 0);
  assert.deepEqual(await listSnapshotRetentionFiles(journal), []);
});

test("a scoped repository reader hands off failed disposal before its handle is lost", async (t) => {
  const { owner, scope, access, create } = await fixture(t, 1, undefined, {
    retentionRecords: 1,
  });
  await create("one");
  const session = scope("one");
  const entry = owner.entries.get(session.sessionDir);
  const failure = new Error("scoped snapshot disposal failed");
  const fault = t.mock.method(entry.journal, "releaseSnapshot", async () => {
    throw failure;
  });
  try {
    await assert.rejects(
      async () => {
        await using reader = await access.open(session);
        assert.equal((await reader.readMetadata()).sessionId, "one");
      },
      { code: "SESSION_SNAPSHOT_RELEASE_UNCERTAIN", cause: failure },
    );
    assert.equal(entry.users, 0);
  } finally {
    fault.mock.restore();
  }
  await using reader = await access.open(session);
  assert.equal((await reader.readMetadata()).sessionId, "one");
});

test("concurrent acquisitions share a journal and an active lease blocks eviction across workspaces", async (t) => {
  const { owner, scope } = await fixture(t);
  const firstWorkspace = scope("one");
  const otherWorkspace = scope("two");
  assert.notEqual(dirname(firstWorkspace.sessionDir), dirname(otherWorkspace.sessionDir));
  const [first, second] = await Promise.all([
    owner.acquire(firstWorkspace, { create: true }),
    owner.acquire(firstWorkspace, { create: true }),
  ]);
  assert.equal(first.journal, second.journal);
  await first.release();
  await first.release();
  await assert.rejects(owner.acquire(otherWorkspace, { create: true }), {
    code: "SESSION_MUTATION_BUSY",
  });
  await second.release();
  await using third = await owner.acquire(otherWorkspace, { create: true });
  assert.equal(first.journal.closed, true);
  assert.equal(third.journal.head.sessionId, "two");
});

test("reader ownership survives until close and shutdown waits for its release", async (t) => {
  const { owner, scope, access, create } = await fixture(t);
  await create("one");
  const reader = await access.open(scope("one"));
  let closed = false;
  const closing = owner.close().then(() => {
    closed = true;
  });
  await assert.rejects(owner.acquire(scope("one")), { code: "SESSION_STORAGE_CLOSED" });
  assert.equal((await reader.readMetadata()).sessionId, "one");
  assert.equal(closed, false);
  await reader.close();
  await closing;
  assert.equal(closed, true);
  assert.equal(owner.entries.size, 0);
});

test("failed explicit close keeps the journal leased until the holder retries", async (t) => {
  const { owner, scope, access, create } = await fixture(t);
  await create("one");
  await using reader = await access.open(scope("one"));
  const entry = owner.entries.get(scope("one").sessionDir);
  const { journal } = entry;
  const failure = new Error("snapshot release failed");
  const fault = t.mock.method(journal, "releaseSnapshot", async () => {
    throw failure;
  });
  const closing = owner.close();
  try {
    await assert.rejects(reader.close(), {
      code: "SESSION_SNAPSHOT_RELEASE_UNCERTAIN",
      cause: failure,
    });
    assert.equal(entry.users, 1);
    assert.equal(owner.entries.size, 1);
    assert.equal((await listSnapshotRetentionFiles(journal)).length, 1);
    await assert.rejects(reader.readMetadata(), { code: "SESSION_READER_CLOSED" });
  } finally {
    fault.mock.restore();
  }
  await reader.close();
  await closing;
  assert.equal(owner.entries.size, 0);
  assert.deepEqual(await listSnapshotRetentionFiles(journal), []);
});

test("eviction cannot detach cleanup between failed explicit close and scope exit", async (t) => {
  const { owner, scope, access, create } = await fixture(t, 1, undefined, {
    retentionRecords: 1,
  });
  await create("one");
  const session = scope("one");
  const { journal } = owner.entries.get(session.sessionDir);
  const failure = new Error("snapshot retention unavailable through scope exit");
  const fault = t.mock.method(journal, "releaseSnapshot", async () => {
    throw failure;
  });
  let evictionError;
  try {
    await assert.rejects(
      async () => {
        await using reader = await access.open(session);
        await assert.rejects(reader.close(), {
          code: "SESSION_SNAPSHOT_RELEASE_UNCERTAIN",
          cause: failure,
        });
        try {
          const lease = await owner.acquire(scope("two"), { create: true });
          await lease.release();
        } catch (cause) {
          evictionError = cause;
        }
      },
      { code: "SESSION_SNAPSHOT_RELEASE_UNCERTAIN", cause: failure },
    );
  } finally {
    fault.mock.restore();
  }

  await using reader = await access.open(session);
  assert.equal((await reader.readMetadata()).sessionId, "one");
  assert.equal(evictionError?.code, "SESSION_MUTATION_BUSY");
});

test("idle eviction and a new owner recover the committed creation without rewriting authority", async (t) => {
  const { owner, scope, access, create, root } = await fixture(t);
  const created = await create("one");
  const before = await readFile(join(scope("one").sessionDir, "CURRENT"));
  await create("two");
  await using reader = await access.open(scope("one"));
  assert.equal((await reader.readMetadata()).sessionId, "one");
  await reader.close();
  await owner.close();
  await using cold = new PartitionJournalOwner({
    durableAncestor: root,
    limits: journalTestLimits(),
    maxJournals: 1,
  });
  const coldAccess = createPartitionSessionReaderAccess({
    acquireJournal: cold.acquire.bind(cold),
    withJournalRemoval: cold.withRemoval.bind(cold),
  });
  const replay = await coldAccess.create(scope("one"), {
    operationId: "create",
    scopedMetadata: null,
    session: emptyPartitionSession({
      sessionId: "one",
      parentSessionId: "",
      committedAt: "2026-11-20T00:00:00.000Z",
    }),
  });
  assert.deepEqual(replay, { ...created, replayed: true });
  assert.deepEqual(await readFile(join(scope("one").sessionDir, "CURRENT")), before);
});

test("failed reader creation and mutation release their leases", async (t) => {
  const { owner, scope, access, create } = await fixture(t, 2);
  assert.equal(await access.readPlacement(scope("absent")), null);
  await assert.rejects(access.open(scope("absent")), { code: "SESSION_STORAGE_CORRUPT" });
  await using unpublished = await owner.acquire(scope("unpublished"), { create: true });
  await unpublished.release();
  await assert.rejects(access.open(scope("unpublished")), { code: "SESSION_STORAGE_CORRUPT" });
  assert.equal(owner.entries.get(scope("unpublished").sessionDir).users, 0);
  await create("one");
  const failure = new Error("mutation failed");
  await assert.rejects(
    access.withMutation(scope("one"), async () => {
      throw failure;
    }),
    (cause) => cause === failure,
  );
  assert.equal(owner.entries.get(scope("one").sessionDir).users, 0);
  await create("two");
});

test("cached owner does not bypass identity and competing authority admission", async (t) => {
  const { owner, scope, create, root } = await fixture(t);
  await create("one");
  await assert.rejects(owner.acquire({ ...scope("one"), sessionId: "foreign" }), {
    code: "SESSION_STORAGE_IDENTITY",
  });
  await writeFile(join(scope("one").sessionDir, "head.json"), "competing authority");
  await assert.rejects(owner.acquire(scope("one")), { code: "SESSION_STORAGE_CORRUPT" });
  await assert.rejects(
    owner.acquire({
      ...scope("one"),
      sessionDir: join(root, "..", "escape"),
    }),
    TypeError,
  );
});

test("shutdown reports failed journals and retries only resources that remain owned", async (t) => {
  const { owner, scope, create } = await fixture(t, 2);
  await create("one");
  await create("two");
  const first = owner.entries.get(scope("one").sessionDir).journal;
  const second = owner.entries.get(scope("two").sessionDir).journal;
  const failure = new Error("journal close failed");
  const closeFirst = first.close.bind(first);
  let attempts = 0;
  t.mock.method(first, "close", async () => {
    attempts += 1;
    if (attempts === 1) throw failure;
    return closeFirst();
  });
  const successful = t.mock.method(second, "close");
  const closing = owner.close();
  assert.equal(owner.close(), closing);
  await assert.rejects(closing, (cause) => {
    assert.ok(cause instanceof AggregateError);
    assert.deepEqual(cause.errors, [failure]);
    return true;
  });
  assert.deepEqual([...owner.entries.keys()], [scope("one").sessionDir]);
  await assert.rejects(owner.acquire(scope("one")), { code: "SESSION_STORAGE_CLOSED" });
  await owner.close();
  assert.equal(attempts, 2);
  assert.equal(successful.mock.callCount(), 1);
  assert.equal(owner.entries.size, 0);
  await owner.close();
  assert.equal(attempts, 2);
});

test("idle retirement does not block resident admissions and joins workspace release", async (t) => {
  const { owner, scope, create } = await fixture(t, 2);
  await create("one");
  await create("two");
  const first = owner.entries.get(scope("one").sessionDir).journal;
  const entered = Promise.withResolvers();
  const unblock = Promise.withResolvers();
  const close = first.close.bind(first);
  const fault = t.mock.method(first, "close", async () => {
    entered.resolve();
    await unblock.promise;
    await close();
  });
  const eviction = create("three");
  await entered.promise;
  const retirement = owner.releaseWorkspace(dirname(scope("one").sessionDir));
  const resident = owner.acquire(scope("two"));
  try {
    const result = await Promise.race([
      resident,
      new Promise((resolve) => setTimeout(() => resolve(null), 500).unref()),
    ]);
    assert.ok(result, "another resident journal must be admitted while close is blocked");
    await result.release();
  } finally {
    unblock.resolve();
    await (await resident).release();
    await Promise.all([eviction, retirement]);
  }
  assert.equal(fault.mock.callCount(), 1);
});

test("resident admission retries failed retirement without leasing the closing journal", async (t) => {
  const { owner, scope, access, create } = await fixture(t);
  await create("one");
  const first = owner.entries.get(scope("one").sessionDir).journal;
  const failure = new Error("journal close failed after it stopped accepting writes");
  const close = first.close.bind(first);
  const fault = t.mock.method(first, "close", async () => {
    await close();
    throw failure;
  });
  const retirementFailure = {
    code: "SESSION_JOURNAL_RETIREMENT_FAILED",
    statusCode: 503,
    cause: failure,
  };
  try {
    await assert.rejects(create("two"), retirementFailure);
    await assert.rejects(async () => {
      const lease = await owner.acquire(scope("one"));
      await lease.release();
    }, retirementFailure);
    await assert.rejects(create("two"), retirementFailure);
    assert.equal(fault.mock.callCount(), 3);
    assert.deepEqual([...owner.entries.keys()], [scope("one").sessionDir]);
  } finally {
    fault.mock.restore();
  }
  await create("two");
  await using reader = await access.open(scope("one"));
  assert.equal((await reader.readMetadata()).sessionId, "one");
  assert.notEqual(owner.entries.get(scope("one").sessionDir).journal, first);
});

for (const published of [false, true]) {
  test(`retirement resolves CURRENT I/O failure (rename completed: ${published}) before releasing its slot`, async (t) => {
    const { owner, scope, create } = await fixture(t, 1, () => {});
    const { sessionDir } = scope("one");
    const workspace = dirname(sessionDir);
    const current = join(sessionDir, "CURRENT");
    const lease = await owner.acquire(scope("one"), { create: true });
    const failedJournal = lease.journal;
    await lease.release();
    const adapter = getFsAdapter();
    const publicationFault = Object.assign(new Error("CURRENT publication interrupted"), {
      code: "EIO",
    });
    let failure;
    setFsAdapter({
      ...adapter,
      async rename(source, target) {
        if (String(target) !== current) return adapter.rename(source, target);
        if (published) await adapter.rename(source, target);
        throw publicationFault;
      },
    });
    try {
      await assert.rejects(create("one"), (error) => {
        assert.equal(error.code, "SESSION_COMMIT_UNCERTAIN");
        assert.equal(error.cause, publicationFault);
        failure = error;
        return true;
      });
    } finally {
      setFsAdapter(adapter);
    }

    const recoveryFault = Object.assign(new Error("Cannot open publication lock for recovery"), {
      code: "EIO",
    });
    setFsAdapter({
      ...adapter,
      async open(file, ...args) {
        if (String(file) === failedJournal.lockPath) throw recoveryFault;
        return adapter.open(file, ...args);
      },
    });
    try {
      const assertOriginalFailure = (error) => error === failure;
      await assert.rejects(owner.acquire(scope("one")), assertOriginalFailure);
      await assert.rejects(owner.releaseWorkspace(workspace), (error) => {
        assert.deepEqual(error.errors[0].errors, [failure, recoveryFault]);
        return true;
      });
      await assert.rejects(owner.acquire(scope("one")), assertOriginalFailure);
      await assert.rejects(create("two"), (error) => {
        assert.equal(error.code, "SESSION_JOURNAL_RETIREMENT_FAILED");
        assert.deepEqual(error.cause.errors, [failure, recoveryFault]);
        return true;
      });
      assert.equal(owner.entries.size, 1);
    } finally {
      setFsAdapter(adapter);
    }

    const authoritativeHead = await readFile(current);
    await owner.releaseWorkspace(workspace);
    assert.equal(owner.entries.size, 0);
    assert.equal(failedJournal.closed, true);
    assert.deepEqual(await readFile(current), authoritativeHead);
    await create("two");
    const result = await create("one");
    assert.equal(result.generation, 1);
    assert.equal(result.replayed, published);
    assert.notEqual(owner.entries.get(sessionDir).journal, failedJournal);
    await owner.close();
  });
}

test("retirement does not treat missing committed data as an unpublished suffix", async (t) => {
  const { owner, scope, create, access } = await fixture(t, 1, () => {});
  await create("one");
  const { sessionDir } = scope("one");
  const current = join(sessionDir, "CURRENT");
  const before = await readFile(current);
  await rm(journalPartitionPath(sessionDir, 0));
  let failure;
  await assert.rejects(access.open(scope("one")), (error) => {
    assert.equal(error.code, "SESSION_STORAGE_CORRUPT");
    failure = error;
    return true;
  });
  await assert.rejects(owner.releaseWorkspace(dirname(sessionDir)), (error) => {
    assert.deepEqual(error.errors, [failure]);
    return true;
  });
  await assert.rejects(owner.acquire(scope("one")), (error) => error === failure);
  await assert.rejects(create("two"), (error) => {
    assert.equal(error.code, "SESSION_JOURNAL_RETIREMENT_FAILED");
    assert.equal(error.cause, failure);
    return true;
  });
  assert.equal(owner.entries.size, 1);
  assert.deepEqual(await readFile(current), before);
});
