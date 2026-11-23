/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { IMMUTABLE_READER_RETENTION } from "@noobot/session-protocol/immutable-storage";
import { IMMUTABLE_VALUE_READ_BATCH_RECORDS } from "@noobot/session-protocol/immutable-storage-graph";
import { withImmutableSessionMigrationSource } from "../src/workspace-lifecycle/immutable-session-migration-source.js";
import { journalHeadPath } from "../src/session/partition-storage/journal-io.js";
import { immutableCheckpointKey } from "../src/session/session-artifact-session/immutable-checkpoint-index.js";
import { checkpointWorkspace } from "./workspace-session-immutable-storage-upgrade.test-helpers.js";

async function collectCommit(source, generation) {
  const changes = [];
  let operation;
  await source.visitCommit(generation, {
    visitOperation: (evidence) => {
      operation = evidence;
    },
    visitChange: (change) => {
      assert.ok(operation, "operation evidence precedes its changes");
      changes.push(change);
    },
  });
  return { operation, changes };
}

test("migration receipt scan does not read changed business values", async (t) => {
  const { sessionDir, store } = await checkpointWorkspace(t);
  const head = await store.snapshot();
  const record = await store.objects.withSnapshot(head, () =>
    store.readCommitRecord(head.commit, head.generation),
  );
  const key = immutableCheckpointKey("t0", "legacy-cp");
  const checkpoint = record.mutations.find((mutation) => mutation.key === key);
  assert.ok(checkpoint?.reference);
  const prototype = Object.getPrototypeOf(store.objects);
  const readValue = prototype.readValue;
  const unavailable = new Error("checkpoint body cannot be read");
  t.mock.method(prototype, "readValue", function (reference, ...args) {
    if (reference === checkpoint.reference) throw unavailable;
    return readValue.call(this, reference, ...args);
  });
  await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    async (source) => {
      let count = 0;
      await source.visitOperations(() => (count += 1));
      assert.equal(count, head.generation);
      await assert.rejects(
        collectCommit(source, head.generation),
        (error) => error === unavailable,
      );
    },
  );
});

test("migration receipt scan rejects a receipt that disagrees with its indexed commit", async (t) => {
  const { sessionDir, store, request } = await checkpointWorkspace(t);
  const head = await store.snapshot();
  const receiptRef = await store.objects.withSnapshot(head, () =>
    store.index.get(head.operations, request.operationId),
  );
  assert.ok(receiptRef);
  const prototype = Object.getPrototypeOf(store.objects);
  const readValue = prototype.readValue;
  t.mock.method(prototype, "readValue", async function (reference, ...args) {
    const value = await readValue.call(this, reference, ...args);
    return reference === receiptRef ? { ...value, generation: head.generation - 1 } : value;
  });
  const generations = [];
  await assert.rejects(
    withImmutableSessionMigrationSource({ sessionDir, expectedSource: null }, (source) =>
      source.visitOperations(({ receipt }) => generations.push(receipt.generation)),
    ),
    {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
      message: "Immutable operation receipt commit identity mismatch",
    },
  );
  assert.deepEqual(
    generations,
    Array.from({ length: head.generation - 1 }, (_, index) => index + 1),
  );
  assert.deepEqual(await readdir(join(sessionDir, IMMUTABLE_READER_RETENTION.directory)), []);
});

test("migration checks the predecessor across operation read windows", async (t) => {
  const { sessionDir, store } = await checkpointWorkspace(t);
  const firstOfNextWindow = IMMUTABLE_VALUE_READ_BATCH_RECORDS + 1;
  for (let { generation } = await store.snapshot(); generation < firstOfNextWindow; generation += 1)
    await store.commit({
      expectedGeneration: generation,
      operationId: `window-${generation}`,
      changes: [{ collection: "metadata", key: "window-test", value: generation }],
    });
  const head = await store.snapshot();
  assert.equal(head.generation, firstOfNextWindow);
  const prototype = Object.getPrototypeOf(store.objects);
  const readValue = prototype.readValue;
  t.mock.method(prototype, "readValue", async function (reference, ...args) {
    const value = await readValue.call(this, reference, ...args);
    return reference === head.commit ? { ...value, previous: head.commit } : value;
  });
  const invalid = {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    message: "Commit chain disagrees with its generation index",
  };
  await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    async (source) => {
      const generations = [];
      await assert.rejects(
        source.visitOperations(({ receipt }) => generations.push(receipt.generation)),
        invalid,
      );
      assert.deepEqual(
        generations,
        Array.from({ length: IMMUTABLE_VALUE_READ_BATCH_RECORDS }, (_, index) => index + 1),
      );
      await assert.rejects(
        source.visitCommit(head.generation, {
          visitOperation: () => assert.fail("unverified operation was exposed"),
          visitChange: () => assert.fail("unverified change was exposed"),
        }),
        invalid,
      );
    },
  );
  assert.deepEqual(await readdir(join(sessionDir, IMMUTABLE_READER_RETENTION.directory)), []);
});

test("migration reads raw checkpoint and original operation evidence from one pinned generation", async (t) => {
  const { sessionDir, store, request } = await checkpointWorkspace(t);
  const head = await store.snapshot();
  const key = immutableCheckpointKey("t0", "legacy-cp");
  const original = await store.get(head, "checkpoints", key);
  assert.equal(original.checkpointId, "legacy-cp");
  let captured;
  await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    async (source) => {
      captured = source;
      assert.equal(source.generation, head.generation);
      assert.deepEqual(source.identity, {
        sessionId: head.sessionId,
        format: head.format,
        generation: head.generation,
        commit: head.commit,
      });
      await store.commit({
        expectedGeneration: head.generation,
        operationId: "after-capture",
        changes: [{ collection: "checkpoints", key, remove: true }],
      });
      const checkpoints = [];
      await source.visitCollection("checkpoints", (key, value) => checkpoints.push([key, value]));
      assert.deepEqual(checkpoints, [[key, original]]);
      const commit = await collectCommit(source, head.generation);
      const { receipt } = await store.readCommittedOperation(head, request.operationId);
      assert.deepEqual(commit.operation, {
        format: "noobot.immutable-migration-operation/1",
        operationId: request.operationId,
        receipt: { ...receipt, retryUnavailable: "original-input-unavailable" },
      });
      assert.equal(receipt.generation, head.generation);
      assert.equal(receipt.commit, head.commit);
      assert.deepEqual(receipt.result.summaryCheckpoints[0].receipt, original);
      const operations = [];
      await source.visitOperations((operation) => operations.push(operation));
      assert.deepEqual(
        operations.map(({ receipt }) => receipt.generation),
        Array.from({ length: head.generation }, (_, index) => index + 1),
      );
      assert.deepEqual(operations.at(-1), commit.operation);
      assert.ok(
        commit.changes.some((change) => change.collection === "checkpoints" && change.key === key),
      );
      await assert.rejects(collectCommit(source, head.generation + 1), TypeError);
    },
  );
  assert.equal(await store.get(await store.snapshot(), "checkpoints", key), null);
  await assert.rejects(collectCommit(captured, head.generation), { code: "SESSION_READER_CLOSED" });
  await assert.rejects(
    captured.visitOperations(() => assert.fail("closed source was visited")),
    {
      code: "SESSION_READER_CLOSED",
    },
  );
  assert.deepEqual(await readdir(join(sessionDir, IMMUTABLE_READER_RETENTION.directory)), []);
});

test("an interrupted migration source visit releases retention and can be reopened", async (t) => {
  const { sessionDir } = await checkpointWorkspace(t);
  const controller = new AbortController();
  const interrupted = new Error("migration interrupted");
  let recorded;
  await assert.rejects(
    withImmutableSessionMigrationSource(
      { sessionDir, expectedSource: null, signal: controller.signal },
      (source) => {
        recorded = JSON.stringify(source.identity);
        return source.visitCollection("metadata", (key) => {
          if (key === "session") controller.abort(interrupted);
        });
      },
    ),
    (error) => error === interrupted,
  );
  assert.deepEqual(await readdir(join(sessionDir, IMMUTABLE_READER_RETENTION.directory)), []);
  const sourceModule = new URL(
    "../src/workspace-lifecycle/immutable-session-migration-source.js",
    import.meta.url,
  );
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      new URL("../../shared/testing/runtime-params.js", import.meta.url).href,
      "--input-type=module",
      "--eval",
      `import { withImmutableSessionMigrationSource } from ${JSON.stringify(sourceModule.href)};
     const [sessionDir, recorded] = process.argv.slice(1);
     const result = await withImmutableSessionMigrationSource(
       { sessionDir, expectedSource: JSON.parse(recorded) }, async (source) => {
         const messages = [];
         await source.visitCollection("messages", (key) => messages.push(key));
         return { identity: source.identity, messages: messages.sort() };
       });
     console.log(JSON.stringify(result));`,
      sessionDir,
      recorded,
    ],
    { timeout: 10000 },
  );
  assert.deepEqual(JSON.parse(stdout), {
    identity: JSON.parse(recorded),
    messages: ["m0", "m1", "m2"],
  });
  assert.deepEqual(await readdir(join(sessionDir, IMMUTABLE_READER_RETENTION.directory)), []);
});

test("an interrupted receipt scan stops visiting and releases the source", async (t) => {
  const { sessionDir } = await checkpointWorkspace(t);
  const controller = new AbortController();
  const interrupted = new Error("receipt scan interrupted");
  const generations = [];
  await assert.rejects(
    withImmutableSessionMigrationSource(
      { sessionDir, expectedSource: null, signal: controller.signal },
      (source) =>
        source.visitOperations(({ receipt }) => {
          generations.push(receipt.generation);
          controller.abort(interrupted);
        }),
    ),
    (error) => error === interrupted,
  );
  assert.deepEqual(generations, [1]);
  assert.deepEqual(await readdir(join(sessionDir, IMMUTABLE_READER_RETENTION.directory)), []);
});

test("migration refuses a changed source on reopen without creating a retention", async (t) => {
  const { sessionDir, store } = await checkpointWorkspace(t);
  const expectedSource = await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    (source) => source.identity,
  );
  await store.commit({
    expectedGeneration: expectedSource.generation,
    operationId: "after-source-release",
    changes: [
      { collection: "checkpoints", key: immutableCheckpointKey("t0", "legacy-cp"), remove: true },
    ],
  });
  for (const source of [expectedSource, { ...expectedSource, sessionId: "other-session" }]) {
    await assert.rejects(
      withImmutableSessionMigrationSource({ sessionDir, expectedSource: source }, () =>
        assert.fail("unexpected source"),
      ),
      { code: "SESSION_MIGRATION_SOURCE_CHANGED" },
    );
  }
  await assert.rejects(
    withImmutableSessionMigrationSource({ sessionDir }, () => assert.fail("unexpected source")),
    TypeError,
  );
  assert.deepEqual(await readdir(join(sessionDir, IMMUTABLE_READER_RETENTION.directory)), []);
});

test("migration refuses a competing partition authority before calling the consumer", async (t) => {
  const { sessionDir } = await checkpointWorkspace(t);
  await writeFile(journalHeadPath(sessionDir), "not opened");
  await assert.rejects(
    withImmutableSessionMigrationSource({ sessionDir, expectedSource: null }, () =>
      assert.fail("unexpected source"),
    ),
    { code: "SESSION_STORAGE_CORRUPT", message: "Session has multiple storage authorities" },
  );
});

test("migration revalidates authority before retaining a discovered head", async (t) => {
  const { sessionDir, store } = await checkpointWorkspace(t);
  const Store = store.constructor;
  const open = Store.open;
  t.mock.method(Store, "open", async function (options) {
    const discovered = await open.call(this, options);
    await writeFile(journalHeadPath(sessionDir), "competing authority");
    return discovered;
  });

  const before = await readdir(sessionDir);
  await assert.rejects(
    withImmutableSessionMigrationSource({ sessionDir, expectedSource: null }, () =>
      assert.fail("unexpected source"),
    ),
    { code: "SESSION_STORAGE_CORRUPT", message: "Session has multiple storage authorities" },
  );
  assert.deepEqual(await readdir(sessionDir), [...before, "CURRENT"].sort());
});
