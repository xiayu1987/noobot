/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { filePath as path } from "@noobot/path-resolver";
import { PARTITION_JOURNAL_PUBLICATION_LOCK } from "@noobot/session-protocol/partition-journal";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import {
  journalCatalogDirectory,
  journalPartitionPath,
  journalRetentionsDirectory,
} from "../../src/session/partition-storage/journal-io.js";
import { journalOffsetsPath } from "../../src/session/partition-storage/journal-offsets.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  createJournalCase,
  journalRequest,
  journalTestLimits,
  wrapHandle,
} from "../helpers/partition-journal-cases.js";

for (const failedTail of [null, journalPartitionPath, journalOffsetsPath]) {
  test(`an already-open writer seals only durable committed bytes after ${failedTail?.name ?? "publication"} fails`, async (t) => {
    const { journal, root, sessionId } = await createJournalCase(
      t,
      { partitionBytes: 4096 },
      { autoClose: false },
    );
    const first = journalRequest(journal, 1, { delta: "a".repeat(2400) });
    const { reference: firstReference } = await journal.append(first);
    const nextWriter = await PartitionJournal.open({ root, sessionId });
    const retryWriter = await PartitionJournal.open({ root, sessionId });
    t.after(() => retryWriter.close());
    const adapter = getFsAdapter();
    setFsAdapter({
      ...adapter,
      async rename(source, target) {
        if (String(target) === path.join(root, "CURRENT"))
          throw Object.assign(new Error("Injected publication failure"), { code: "EIO" });
        return adapter.rename(source, target);
      },
    });
    try {
      await assert.rejects(journal.append(journalRequest(journal, 2, { delta: "aborted" })), {
        code: "SESSION_COMMIT_UNCERTAIN",
      });
      await assert.rejects(journal.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
    } finally {
      setFsAdapter(adapter);
    }
    const second = journalRequest(retryWriter, 2, { delta: "b".repeat(2400) });
    let receipt;
    if (failedTail) {
      const target = failedTail(root, 0);
      const events = [];
      const before = await adapter.readFile(path.join(root, "CURRENT"));
      let fail = true;
      setFsAdapter({
        ...adapter,
        async open(file, ...args) {
          const handle = await adapter.open(file, ...args);
          if (String(file) !== target) return handle;
          return wrapHandle(handle, {
            async truncate(...truncateArgs) {
              await handle.truncate(...truncateArgs);
              events.push("truncate");
            },
            async sync() {
              if (fail)
                throw Object.assign(new Error("Injected tail sync failure"), { code: "EIO" });
              await handle.sync();
              events.push("sync");
            },
          });
        },
        async rename(source, destination) {
          await adapter.rename(source, destination);
          if (String(destination) === path.join(root, "CURRENT")) events.push("CURRENT");
        },
      });
      try {
        await assert.rejects(nextWriter.append(second), (error) => {
          assert.equal(error.code, "SESSION_COMMIT_UNCERTAIN");
          assert.equal(error.cause.code, "EIO");
          assert.equal(error.cause.message, "Injected tail sync failure");
          return true;
        });
        await assert.rejects(nextWriter.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
        assert.deepEqual(await adapter.readFile(path.join(root, "CURRENT")), before);
        assert.deepEqual(events, ["truncate"]);
        fail = false;
        receipt = await retryWriter.append(second);
        assert.deepEqual(events, ["truncate", "sync", "CURRENT"]);
      } finally {
        setFsAdapter(adapter);
      }
    } else {
      await nextWriter.close();
      receipt = await retryWriter.append(second);
    }
    assert.equal(receipt.replayed, false);
    assert.equal(receipt.reference.partition, 1);
    await retryWriter.usingSnapshot(async (snapshot) => {
      const page = await retryWriter.readPage({
        snapshot,
        cursor: { partition: 0, offset: 0, sequence: 0 },
      });
      assert.deepEqual(
        page.records.map(({ request }) => request),
        [first, second],
      );
      const exact = await retryWriter.readSequencePage({ snapshot, sequence: 1 });
      assert.deepEqual(exact.records[0].request, first);
    });
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const replay = await reopened.append(second);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.reference, receipt.reference);
    await reopened.usingSnapshot(async (snapshot) => {
      const oldRecord = await reopened.readRecord({ snapshot, reference: firstReference });
      const newRecord = await reopened.readRecord({ snapshot, reference: replay.reference });
      assert.deepEqual(oldRecord.request, first);
      assert.deepEqual(newRecord.request, second);
    });
  });
}

for (const failedFile of [journalPartitionPath, journalOffsetsPath]) {
  test(`ENOSPC at ${failedFile.name} leaves the retained reader and retry window intact`, async (t) => {
    const { journal, root, sessionId } = await createJournalCase(
      t,
      { partitionRecords: 1 },
      { autoClose: false },
    );
    const first = journalRequest(journal, 1);
    const second = journalRequest(journal, 2);
    const { reference } = await journal.append(first);
    await journal.usingSnapshot(async (snapshot) => {
      const adapter = getFsAdapter();
      const current = path.join(root, "CURRENT");
      const published = await adapter.readFile(current);
      const full = Object.assign(new Error("Injected disk full"), { code: "ENOSPC" });
      setFsAdapter({
        ...adapter,
        async open(file, ...args) {
          const handle = await adapter.open(file, ...args);
          if (String(file) !== failedFile(root, 1) || args[0] === "r") return handle;
          return wrapHandle(handle, {
            async write() {
              throw full;
            },
          });
        },
      });
      try {
        await assert.rejects(journal.append(second), (error) => {
          assert.equal(error.code, "SESSION_COMMIT_UNCERTAIN");
          assert.equal(error.cause, full);
          return true;
        });
        assert.deepEqual(await adapter.readFile(current), published);
      } finally {
        setFsAdapter(adapter);
      }

      const reopened = await PartitionJournal.open({ root, sessionId });
      t.after(() => reopened.close());
      const replay = await reopened.append(first);
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.reference, reference);
      assert.deepEqual(await adapter.readFile(current), published);
      assert.equal((await reopened.append(second)).replayed, false);
      assert.equal((await reopened.append(second)).replayed, true);
      assert.deepEqual((await journal.readRecord({ snapshot, reference })).request, first);
    });
    await assert.rejects(journal.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
  });
}

for (const budget of ["records", "bytes"]) {
  test(`an uncertain group commit can replay its first published request within the retry ${budget} budget`, async (t) => {
    const { journal, root, sessionId } = await createJournalCase(
      t,
      budget === "records" ? { receiptRecords: 1 } : { receiptBytes: 4096 },
      { autoClose: false },
    );
    const payload = { delta: "x".repeat(budget === "bytes" ? 2400 : 5) };
    const first = journalRequest(journal, 1, payload);
    const second = journalRequest(journal, 2, payload);
    const adapter = getFsAdapter();
    const current = path.join(root, "CURRENT");
    setFsAdapter({
      ...adapter,
      async rename(source, target) {
        await adapter.rename(source, target);
        if (String(target) === current)
          throw Object.assign(new Error("Injected failure after CURRENT rename"), { code: "EIO" });
      },
    });
    try {
      const outcomes = await Promise.allSettled([journal.append(first), journal.append(second)]);
      for (const outcome of outcomes) {
        assert.equal(outcome.status, "rejected");
        assert.equal(outcome.reason.code, "SESSION_COMMIT_UNCERTAIN");
      }
      await assert.rejects(journal.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
    } finally {
      setFsAdapter(adapter);
    }
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    assert.equal(reopened.head.sequence, 1);
    assert.equal((await reopened.append(first)).replayed, true);
    assert.equal((await reopened.append(second)).replayed, false);
  });
}

test("rollover syncs the sealed tail and new partition before CURRENT; append does not touch directories", async (t) => {
  const { journal, root } = await createJournalCase(t, { partitionRecords: 2 });
  const partitions = path.join(root, "partitions");
  const adapter = getFsAdapter();
  const events = [];
  const created = [];
  setFsAdapter({
    ...adapter,
    async mkdir(directory, ...args) {
      if (String(directory).startsWith(`${partitions}${path.sep}`)) created.push(String(directory));
      return adapter.mkdir(directory, ...args);
    },
    async syncDirectory(directory) {
      const result = await adapter.syncDirectory(directory);
      for (const partition of [0, 1]) {
        if (directory === path.dirname(journalPartitionPath(root, partition)))
          events.push(`${partition}:directory`);
      }
      return result;
    },
    async open(file, ...args) {
      const handle = await adapter.open(file, ...args);
      const relative = path.relative(partitions, String(file));
      const parts = relative.split(path.sep);
      if (parts[0] === ".." || parts.length < 3) return handle;
      const kind = parts.at(-1);
      if (!["records.log", "offsets.idx"].includes(kind)) return handle;
      const partition =
        String(file).startsWith(`${path.dirname(journalPartitionPath(root, 0))}${path.sep}`) ||
        String(file) === path.dirname(journalPartitionPath(root, 0))
          ? 0
          : 1;
      return wrapHandle(handle, {
        async sync() {
          await handle.sync();
          events.push(`${partition}:${kind}`);
        },
      });
    },
    async rename(source, target) {
      await adapter.rename(source, target);
      if (String(target) === path.join(root, "CURRENT")) events.push("CURRENT");
      if (path.basename(String(target)) === "START")
        events.push(
          `${path.dirname(String(target)) === path.dirname(journalPartitionPath(root, 0)) ? 0 : 1}:START`,
        );
    },
  });
  try {
    for (const sequence of [1, 2, 3]) {
      events.length = 0;
      created.length = 0;
      await journal.append(journalRequest(journal, sequence));
      assert.deepEqual(
        created,
        sequence === 2 ? [] : [path.dirname(journalPartitionPath(root, sequence === 1 ? 0 : 1))],
      );
      const tailSyncs = ["0:records.log", "0:offsets.idx"];
      assert.deepEqual(events.slice(0, 2).sort(), tailSyncs.toSorted());
      const remaining = events.slice(2);
      if (sequence === 3) {
        assert.deepEqual(remaining.splice(0, 2).sort(), ["1:offsets.idx", "1:records.log"]);
      }
      assert.deepEqual(remaining, [
        ...(sequence === 2 ? [] : ["0:START", "0:directory"]),
        ...(sequence === 3 ? ["1:START", "1:directory"] : []),
        "CURRENT",
      ]);
    }
  } finally {
    setFsAdapter(adapter);
  }
});

test("first append retry makes existing unpublished directory ancestors durable before CURRENT", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(
    t,
    { partitionRecords: 1 },
    { autoClose: false },
  );
  const retry = await PartitionJournal.open({ root, sessionId });
  t.after(() => retry.close());
  const partition = path.dirname(journalPartitionPath(root, 0));
  const parent = path.dirname(partition);
  const current = path.join(root, "CURRENT");
  const adapter = getFsAdapter();
  const before = await adapter.readFile(current);
  const events = [];
  const failure = Object.assign(new Error("Interrupted ancestor sync"), { code: "EIO" });
  let interrupt = true;
  setFsAdapter({
    ...adapter,
    async syncDirectory(directory) {
      if (directory === parent && interrupt) throw failure;
      const result = await adapter.syncDirectory(directory);
      if (directory === parent) events.push("ancestor synced");
      return result;
    },
    async rename(source, target, ...args) {
      await adapter.rename(source, target, ...args);
      if (String(target) === current) events.push("CURRENT");
    },
  });
  try {
    const request = journalRequest(journal, 1);
    await assert.rejects(journal.append(request), { cause: failure });
    await assert.rejects(journal.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
    await adapter.stat(partition);
    assert.deepEqual(await adapter.readFile(current), before);
    interrupt = false;
    await retry.append(request);
    assert.deepEqual(events, ["ancestor synced", "CURRENT"]);
  } finally {
    setFsAdapter(adapter);
  }
});

test("initialization retry syncs every journal ancestor up to the durable container", async (t) => {
  const { root: durableAncestor } = await createJournalCase(t);
  const outer = path.join(durableAncestor, "outer");
  const inner = path.join(outer, "inner");
  const root = path.join(inner, "journal");
  const current = path.join(root, "CURRENT");
  const adapter = getFsAdapter();
  const failure = Object.assign(new Error("Interrupted initialization ancestor sync"), {
    code: "EIO",
  });
  const events = [];
  let interrupt = true;
  setFsAdapter({
    ...adapter,
    async syncDirectory(directory) {
      if (interrupt && directory === outer) throw failure;
      const result = await adapter.syncDirectory(directory);
      if ([inner, outer, durableAncestor].includes(directory)) events.push(directory);
      return result;
    },
    async link(source, target, ...args) {
      await adapter.link(source, target, ...args);
      if (String(target) === current) events.push(current);
    },
  });
  const options = {
    root,
    durableAncestor,
    sessionId: "nested",
    limits: journalTestLimits(),
    publication: "journal",
  };
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(PartitionJournal.create(options), failure);
      await adapter.stat(inner);
      await assert.rejects(adapter.stat(current), { code: "ENOENT" });
      assert.ok(!events.includes(current));
    }
    events.length = 0;
    interrupt = false;
    const created = await PartitionJournal.create(options);
    t.after(() => created.close());
    assert.deepEqual(events, [inner, outer, durableAncestor, current]);
    const head = await adapter.readFile(current);
    await assert.rejects(PartitionJournal.create(options), { code: "EEXIST" });
    assert.deepEqual(await adapter.readFile(current), head);
  } finally {
    setFsAdapter(adapter);
  }
});

test("bootstrap can retry after creating the root but before installing CURRENT", async (t) => {
  const { root: durableAncestor } = await createJournalCase(t);
  const root = path.join(durableAncestor, "retry");
  const current = path.join(root, "CURRENT");
  const options = {
    root,
    durableAncestor,
    sessionId: "retry",
    limits: journalTestLimits(),
    publication: "journal",
  };
  const adapter = getFsAdapter();
  const failure = Object.assign(new Error("Interrupted bootstrap parent sync"), { code: "EIO" });
  setFsAdapter({
    ...adapter,
    async syncDirectory(directory) {
      if (directory === durableAncestor) throw failure;
      return adapter.syncDirectory(directory);
    },
  });
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(PartitionJournal.create(options), failure);
      await adapter.stat(root);
      await assert.rejects(adapter.stat(current), { code: "ENOENT" });
    }
  } finally {
    setFsAdapter(adapter);
  }
  const journal = await PartitionJournal.create(options);
  t.after(() => journal.close());
  assert.equal(journal.head.sequence, 0);
});

for (const target of ["lock file", "root directory"]) {
  test(`bootstrap does not expose CURRENT when the initial ${target} sync fails`, async (t) => {
    const { root: durableAncestor } = await createJournalCase(t);
    const root = path.join(durableAncestor, "bootstrap");
    const lock = path.join(root, PARTITION_JOURNAL_PUBLICATION_LOCK);
    const current = path.join(root, "CURRENT");
    const options = {
      root,
      durableAncestor,
      sessionId: "bootstrap",
      limits: journalTestLimits(),
      publication: "journal",
    };
    const adapter = getFsAdapter();
    const failure = Object.assign(new Error(`Injected ${target} sync failure`), { code: "EIO" });
    const syncs = [];
    setFsAdapter({
      ...adapter,
      async syncDirectory(directory) {
        if (directory === root) {
          syncs.push("root directory");
          if (target === "root directory") throw failure;
        }
        return adapter.syncDirectory(directory);
      },
      async open(file, ...args) {
        const handle = await adapter.open(file, ...args);
        const kind = file === lock ? "lock file" : null;
        if (!kind) return handle;
        return wrapHandle(handle, {
          async sync() {
            syncs.push(kind);
            if (kind === target) throw failure;
            await handle.sync();
          },
        });
      },
      async link(source, destination) {
        assert.notEqual(destination, current);
        return adapter.link(source, destination);
      },
    });
    try {
      await assert.rejects(PartitionJournal.create(options), failure);
      assert.deepEqual(syncs, target === "lock file" ? [target] : ["lock file", target]);
      await assert.rejects(adapter.stat(current), { code: "ENOENT" });
    } finally {
      setFsAdapter(adapter);
    }
    const journal = await PartitionJournal.create(options);
    t.after(() => journal.close());
    assert.equal(journal.head.sequence, 0);
  });
}

test("reopen and append reject a missing publication lock without recreating it", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t, {}, { autoClose: false });
  const adapter = getFsAdapter();
  const lock = path.join(root, PARTITION_JOURNAL_PUBLICATION_LOCK);
  const current = path.join(root, "CURRENT");
  const before = await adapter.readFile(current);
  await adapter.rename(lock, `${lock}.missing`);
  await assert.rejects(PartitionJournal.open({ root, sessionId }), {
    code: "SESSION_STORAGE_CORRUPT",
  });
  await assert.rejects(journal.append(journalRequest(journal, 1)), {
    code: "SESSION_STORAGE_CORRUPT",
  });
  await assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" });
  await assert.rejects(adapter.stat(lock), { code: "ENOENT" });
  assert.deepEqual(await adapter.readFile(current), before);
});

test("a visible bootstrap is reopened only after a successful durability barrier", async (t) => {
  const { root: durableAncestor } = await createJournalCase(t);
  const root = path.join(durableAncestor, "uncertain");
  const current = path.join(root, "CURRENT");
  const options = {
    root,
    durableAncestor,
    sessionId: "uncertain",
    limits: journalTestLimits(),
    publication: "journal",
  };
  const adapter = getFsAdapter();
  const failure = Object.assign(new Error("Interrupted bootstrap root sync"), { code: "EIO" });
  let linked = false;
  setFsAdapter({
    ...adapter,
    async link(source, target) {
      await adapter.link(source, target);
      if (target === current) linked = true;
    },
    async syncDirectory(directory) {
      if (directory === root && linked) throw failure;
      return adapter.syncDirectory(directory);
    },
  });
  let published;
  try {
    await assert.rejects(PartitionJournal.create(options), failure);
    published = await adapter.readFile(current);
    await assert.rejects(PartitionJournal.create(options), { code: "EEXIST" });
    await assert.rejects(PartitionJournal.open(options), failure);
  } finally {
    setFsAdapter(adapter);
  }
  const journal = await PartitionJournal.open(options);
  t.after(() => journal.close());
  assert.deepEqual(await adapter.readFile(current), published);
  assert.equal(journal.head.sequence, 0);
});

test("racing bootstrap publishers cannot overwrite CURRENT", async (t) => {
  const { root: durableAncestor } = await createJournalCase(t);
  const root = path.join(durableAncestor, "race");
  const options = { root, durableAncestor, limits: journalTestLimits(), publication: "journal" };
  const results = await Promise.allSettled([
    PartitionJournal.create({ ...options, sessionId: "first" }),
    PartitionJournal.create({ ...options, sessionId: "second" }),
  ]);
  const winners = results.filter((result) => result.status === "fulfilled");
  const losers = results.filter((result) => result.status === "rejected");
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  assert.equal(losers[0].reason.code, "EEXIST");
  const winner = winners[0].value;
  const reopened = await PartitionJournal.open({ root, sessionId: winner.head.sessionId });
  t.after(() => Promise.all([winner.close(), reopened.close()]));
  assert.deepEqual(reopened.head, winner.head);
});

test("bootstrap rejects committed data without CURRENT and leaves it untouched", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t);
  await journal.append(journalRequest(journal, 1));
  await journal.close();
  const adapter = getFsAdapter();
  const current = path.join(root, "CURRENT");
  const detachedCurrent = `${current}.detached`;
  const log = journalPartitionPath(root, 0);
  const original = await adapter.readFile(log);
  await adapter.rename(current, detachedCurrent);

  await assert.rejects(
    PartitionJournal.create({
      root,
      durableAncestor: path.dirname(root),
      sessionId,
      limits: journalTestLimits(),
      publication: "journal",
    }),
    { code: "SESSION_STORAGE_CORRUPT" },
  );
  await assert.rejects(adapter.lstat(current), { code: "ENOENT" });
  assert.deepEqual(await adapter.readFile(log), original);

  await adapter.rename(detachedCurrent, current);
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  assert.equal(reopened.head.sequence, 1);
});

for (const storageDirectory of [journalCatalogDirectory, journalRetentionsDirectory]) {
  test(`bootstrap preserves an isolated ${storageDirectory.name} without CURRENT`, async (t) => {
    const { root: durableAncestor } = await createJournalCase(t);
    const root = path.join(durableAncestor, "incomplete");
    const directory = storageDirectory(root);
    const adapter = getFsAdapter();
    const file = path.join(directory, "preserved");
    const original = Buffer.from("retained storage bytes");
    await adapter.mkdir(directory, { recursive: true });
    await adapter.writeFile(file, original);

    await assert.rejects(
      PartitionJournal.create({
        root,
        durableAncestor,
        sessionId: "incomplete",
        limits: journalTestLimits(),
        publication: "collections",
      }),
      { code: "SESSION_STORAGE_CORRUPT" },
    );
    assert.deepEqual(await adapter.readdir(root), [path.basename(directory)]);
    assert.deepEqual(await adapter.readdir(directory), [path.basename(file)]);
    assert.deepEqual(await adapter.readFile(file), original);
  });
}

test("append fails without recreating a missing published partition", async (t) => {
  const { journal, root } = await createJournalCase(t, {}, { autoClose: false });
  await journal.append(journalRequest(journal, 1));
  const adapter = getFsAdapter();
  const partition = path.dirname(journalPartitionPath(root, 0));
  const current = path.join(root, "CURRENT");
  const before = await adapter.readFile(current);
  await adapter.rename(partition, `${partition}.missing`);

  await assert.rejects(journal.append(journalRequest(journal, 2)), (error) => {
    assert.equal(error.code, "SESSION_COMMIT_UNCERTAIN");
    assert.ok(error.cause instanceof AggregateError);
    assert.deepEqual(
      error.cause.errors.map((cause) => cause.code),
      ["SESSION_STORAGE_CORRUPT", "SESSION_STORAGE_CORRUPT"],
    );
    assert.deepEqual(
      error.cause.errors.map((cause) => cause.cause.code),
      ["ENOENT", "ENOENT"],
    );
    assert.deepEqual(
      error.cause.errors.map((cause) => cause.cause.path),
      [journalPartitionPath(root, 0), path.join(partition, "offsets.idx")],
    );
    return true;
  });
  await assert.rejects(journal.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
  await assert.rejects(adapter.stat(partition), { code: "ENOENT" });
  assert.deepEqual(await adapter.readFile(current), before);
});

test("a failed frame sync waits for the index to close without publishing CURRENT", async (t) => {
  const { journal, root } = await createJournalCase(t, {}, { autoClose: false });
  const adapter = getFsAdapter();
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const current = path.join(root, "CURRENT");
  const before = await adapter.readFile(current);
  const failure = Object.assign(new Error("Injected frame sync failure"), { code: "EIO" });
  let indexClosed = false;
  setFsAdapter({
    ...adapter,
    async open(file, ...args) {
      const handle = await adapter.open(file, ...args);
      if (String(file).endsWith("records.log"))
        return wrapHandle(handle, {
          sync: async () => {
            throw failure;
          },
        });
      if (String(file).endsWith("offsets.idx"))
        return wrapHandle(handle, {
          async sync() {
            entered.resolve();
            await release.promise;
            await handle.sync();
          },
          async close() {
            await handle.close();
            indexClosed = true;
          },
        });
      return handle;
    },
  });
  const pending = journal.append(journalRequest(journal, 1));
  const settled = pending.then(
    () => true,
    () => true,
  );
  try {
    assert.equal(await Promise.race([entered.promise, settled]), undefined);
    assert.equal(
      await Promise.race([settled, new Promise((resolve) => setImmediate(resolve, false))]),
      false,
    );
    assert.deepEqual(await adapter.readFile(current), before);
  } finally {
    release.resolve();
    await settled;
    setFsAdapter(adapter);
  }
  assert.equal(indexClosed, true);
  await assert.rejects(
    pending,
    (error) => error.code === "SESSION_COMMIT_UNCERTAIN" && error.cause === failure,
  );
  await assert.rejects(journal.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
  assert.deepEqual(await adapter.readFile(current), before);
});

for (const boundary of [
  "data-sync",
  "index-sync",
  "before-directory-publication",
  "after-directory-publication",
  "before-publication",
  "after-publication",
]) {
  test(`I/O failure ${boundary} reports uncertainty and reopens to one authoritative outcome`, async (t) => {
    const { journal, root, sessionId } = await createJournalCase(t, {}, { autoClose: false });
    const request = journalRequest(journal, 1);
    const previousAdapter = getFsAdapter();
    let published = false;
    let directoryPublished = false;
    let injected = false;
    const fail = () => {
      injected = true;
      throw Object.assign(new Error("Injected storage failure"), { code: "EIO" });
    };
    setFsAdapter({
      ...previousAdapter,
      async syncDirectory(directory) {
        if (
          (boundary === "after-directory-publication" &&
            directoryPublished &&
            directory.startsWith(path.join(root, "partitions"))) ||
          (boundary === "after-publication" && directory === root && published)
        )
          fail();
        return previousAdapter.syncDirectory(directory);
      },
      async open(file, ...args) {
        const handle = await previousAdapter.open(file, ...args);
        const isData = String(file).endsWith("records.log");
        const isIndex = String(file).endsWith("offsets.idx");
        if ((boundary === "data-sync" && isData) || (boundary === "index-sync" && isIndex))
          return wrapHandle(handle, { sync: fail });
        return handle;
      },
      async rename(source, target) {
        if (path.basename(String(target)) === "START") {
          if (boundary === "before-directory-publication") fail();
          await previousAdapter.rename(source, target);
          directoryPublished = true;
          return;
        }
        if (String(target) === path.join(root, "CURRENT")) {
          if (boundary === "before-publication") fail();
          await previousAdapter.rename(source, target);
          published = true;
          return;
        }
        return previousAdapter.rename(source, target);
      },
    });
    try {
      await assert.rejects(journal.append(request), { code: "SESSION_COMMIT_UNCERTAIN" });
      await assert.rejects(journal.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
      assert.equal(injected, true);
    } finally {
      setFsAdapter(previousAdapter);
    }
    const restored = await PartitionJournal.open({ root, sessionId });
    t.after(() => restored.close());
    const before = await restored.snapshot();
    assert.equal(before.sequence, boundary === "after-publication" ? 1 : 0);
    const result = await restored.append(request);
    assert.equal(result.replayed, boundary === "after-publication");
    const snapshot = await restored.snapshot();
    assert.equal(snapshot.sequence, 1);
    const page = await restored.readPage({
      snapshot,
      cursor: { partition: 0, offset: 0, sequence: 0 },
    });
    assert.equal(page.records.length, 1);
    assert.deepEqual(page.records[0].request, request);
  });
}
