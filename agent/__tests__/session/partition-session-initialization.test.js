/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { borrowFixtureJournal } from "../helpers/partition-journal-lease.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { PARTITION_SESSION_METADATA } from "@noobot/session-protocol/partition-transaction";
import { emptySessionDisplaySourceCounts } from "@noobot/session-protocol/session-reader";
import { createPartitionSessionReaderAccess } from "../../src/session/partition-storage/partition-reader-access.js";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { PartitionSessionTransactions } from "../../src/session/partition-storage/partition-session-transactions.js";
import { PartitionSessionMessages } from "../../src/session/partition-storage/partition-session-messages.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  createTransactionCase,
  commitFixtureTransaction,
} from "../helpers/partition-journal-cases.js";
import { emptyPartitionSession } from "../helpers/partition-session-cases.js";

const ts = "2026-11-20T00:00:00.000Z";

async function fixture(t, limits, options) {
  const state = await createTransactionCase(t, limits, options);
  const scope = { sessionId: state.sessionId, parentSessionId: "" };
  const repository = new PartitionSessionTransactions(state.journal, scope);
  const session = emptyPartitionSession({ ...scope, committedAt: ts });
  const prepare = (value = session, operationId = "initialize", scopedMetadata = null) =>
    state.journal.usingSnapshot((snapshot) =>
      repository.prepareInitialization(snapshot, { operationId, session: value, scopedMetadata }),
    );
  return { ...state, scope, session, repository, prepare };
}

test("initialization publishes session authority atomically and allows real message commits", async (t) => {
  const { journal, repository, scope, session, prepare } = await fixture(t);
  const request = await prepare();
  session.modelAlias = "caller-mutation";
  const created = await repository.initialize(request);
  assert.equal(created.generation, 1);
  assert.equal(created.result.metadata.modelAlias, "");
  assert.equal(Object.hasOwn(created.result.metadata, "messages"), false);
  const collection = "metadata";
  const key = "display:statistics";
  assert.equal(
    created.mutations.filter(
      (mutation) => mutation.collection === collection && mutation.key === key,
    ).length,
    1,
  );
  const messages = new PartitionSessionMessages(journal, scope);
  await journal.usingSnapshot(async (snapshot) => {
    assert.deepEqual(await messages.readDisplaySourceCounts({ snapshot }), {
      messageCount: 0,
      ...emptySessionDisplaySourceCounts(),
    });
    const descriptor = await repository.read(snapshot, async (read) =>
      (await read({ collection: "metadata", keys: ["lifecycleIndex"] })).get("lifecycleIndex"),
    );
    assert.deepEqual(descriptor.value, { version: 1, root: null });
    assert.deepEqual(
      await messages.readSessionMessageOrderPage({ snapshot, cursor: null, limit: 1 }),
      { entries: [], nextCursor: null },
    );
    const append = await messages.prepareRequest(snapshot, {
      operationId: "append",
      committedAt: ts,
      changes: {
        messages: [
          {
            sessionId: scope.sessionId,
            messageUid: "first",
            modelMessageId: "model-first",
            presentationMessageId: "presentation-first",
            dialogProcessId: "dialog",
            turnScopeId: "turn",
            role: "assistant",
            type: "message",
            content: "body",
            attachments: [],
            ts,
          },
        ],
      },
    });
    await messages.commit(append);
    assert.deepEqual(
      await messages.readSessionMessageOrderPage({ snapshot, cursor: null, limit: 1 }),
      { entries: [], nextCursor: null },
    );
  });
  const head = journal.head;
  assert.deepEqual(await repository.initialize(request), { ...created, replayed: true });
  assert.deepEqual(journal.head, head);
  await journal.usingSnapshot(async (snapshot) => {
    assert.deepEqual(
      await messages.readSessionMessageOrderPage({ snapshot, cursor: null, limit: 1 }),
      { entries: ["first"], nextCursor: null },
    );
  });
});

test("cold reopen replays the original initialization and rejects foreign scope before replay", async (t) => {
  const { journal, repository, prepare, root, sessionId, scope } = await fixture(t);
  const request = await prepare();
  const created = await repository.initialize(request);
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const bytes = await readFile(join(root, "CURRENT"));
  const foreign = new PartitionSessionTransactions(reopened, {
    ...scope,
    parentSessionId: "other",
  });
  await assert.rejects(foreign.initialize(request), { code: "SESSION_SCOPE_IDENTITY_CONFLICT" });
  const reader = new PartitionSessionTransactions(reopened, scope);
  assert.deepEqual(await reader.initialize(request), { ...created, replayed: true });
  assert.deepEqual(await readFile(join(root, "CURRENT")), bytes);
});

for (const [label, change] of [
  [
    "aggregate version",
    (session) => {
      session.aggregateVersion = 1;
    },
  ],
  [
    "dialog membership",
    (session) => {
      session.dialogOrder = [{}];
    },
  ],
  [
    "artifact events",
    (session) => {
      session.sessionArtifactEvents = [{}];
    },
  ],
  [
    "missing artifact collection",
    (session) => {
      delete session.sessionArtifactEvents;
    },
  ],
  [
    "checkpoint history",
    (session) => {
      session.turnSummaryCheckpoints = { turn: {} };
    },
  ],
  [
    "lifecycle sequence",
    (session) => {
      session.turnLifecycle.sequence = 1;
    },
  ],
  [
    "creation time",
    (session) => {
      session.createdAt = "invalid";
    },
  ],
]) {
  test(`invalid initial ${label} leaves the journal empty and permits a valid request`, async (t) => {
    const { journal, repository, session, prepare } = await fixture(t);
    const invalid = structuredClone(session);
    change(invalid);
    const head = journal.head;
    await assert.rejects(repository.initialize(await prepare(invalid)), {
      code: "SESSION_COMMIT_INPUT_INVALID",
    });
    assert.deepEqual(journal.head, head);
    assert.equal((await repository.initialize(await prepare())).generation, 1);
  });
}

for (const field of ["sessionId", "parentSessionId"]) {
  test(`foreign initial ${field} is rejected without terminating the writer`, async (t) => {
    const { journal, repository, prepare, session } = await fixture(t);
    const head = journal.head;
    await assert.rejects(repository.initialize(await prepare({ ...session, [field]: "foreign" })), {
      code: "SESSION_SCOPE_IDENTITY_CONFLICT",
      statusCode: 409,
    });
    assert.deepEqual(journal.head, head);
    assert.equal((await repository.initialize(await prepare())).generation, 1);
  });
}

test("a second initialization cannot replace existing session authority", async (t) => {
  const { journal, repository, prepare, session } = await fixture(t);
  await repository.initialize(await prepare());
  const head = journal.head;
  await assert.rejects(
    repository.initialize(await prepare({ ...session, modelAlias: "replacement" }, "second")),
    { code: "SESSION_OPERATION_CONFLICT" },
  );
  assert.deepEqual(journal.head, head);
});

test("published metadata removal is corruption rather than an uninitialized session", async (t) => {
  const { journal, repository, prepare, scope, root } = await fixture(t, undefined, {
    autoClose: false,
  });
  const created = await repository.initialize(await prepare());
  const owner = created.mutations.find(({ key }) => key === "session").owner;
  await commitFixtureTransaction(new PartitionTransactions(journal), {
    epoch: journal.head.epoch,
    expectedGeneration: journal.head.sequence,
    sequence: journal.head.sequence + 1,
    operationId: "remove-metadata",
    input: {},
    mutations: [{ ...PARTITION_SESSION_METADATA, owner, remove: true }],
    result: null,
  });
  const head = journal.head;
  const access = createPartitionSessionReaderAccess({
    acquireJournal: () => borrowFixtureJournal(journal),
    withJournalRemoval: () => assert.fail("Unexpected journal removal"),
  });
  await assert.rejects(access.readPlacement({ sessionDir: root, sessionId: scope.sessionId }), {
    code: "SESSION_STORAGE_CORRUPT",
  });
  const reader = new PartitionSessionTransactions(journal, scope);
  await assert.rejects(reader.initialize(await prepare()), { code: "SESSION_STORAGE_CORRUPT" });
  assert.deepEqual(journal.head, head);
  await assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" });
});

for (const published of [false, true]) {
  test(`initialization recovers an uncertain publication ${published ? "after" : "before"} CURRENT rename`, async (t) => {
    const { journal, repository, root, sessionId, scope, prepare } = await fixture(t, undefined, {
      autoClose: false,
    });
    const scopedMetadata = { workspace: { label: "initial" } };
    const request = await prepare(undefined, "initialize", scopedMetadata);
    const before = await readFile(join(root, "CURRENT"));
    const adapter = getFsAdapter();
    let injected = false;
    setFsAdapter({
      ...adapter,
      async rename(source, target) {
        if (!injected && String(target) === join(root, "CURRENT")) {
          injected = true;
          if (published) await adapter.rename(source, target);
          throw Object.assign(new Error("initialization publication fault"), { code: "EIO" });
        }
        return adapter.rename(source, target);
      },
    });
    try {
      await assert.rejects(repository.initialize(request), (error) => {
        assert.equal(error.code, "SESSION_COMMIT_UNCERTAIN");
        assert.equal(error.cause.code, "EIO");
        assert.equal(error.cause.message, "initialization publication fault");
        return true;
      });
    } finally {
      setFsAdapter(adapter);
    }
    assert.equal(injected, true);
    if (!published) assert.deepEqual(await readFile(join(root, "CURRENT")), before);
    await assert.rejects(journal.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const recovered = new PartitionSessionTransactions(reopened, scope);
    assert.equal(reopened.head.sequence, published ? 1 : 0);
    const result = await recovered.initialize(request);
    assert.equal(result.replayed, published);
    assert.equal(result.generation, 1);
    assert.equal(reopened.head.sequence, 1);
    await using reader = await openPartitionSessionReader({ journal: reopened, ...scope });
    assert.deepEqual(await reader.readScopedMetadata(), scopedMetadata);
    const head = reopened.head;
    assert.deepEqual(await recovered.initialize(request), { ...result, replayed: true });
    assert.deepEqual(reopened.head, head);
  });
}
