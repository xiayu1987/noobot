/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  writeFile,
  appendFile,
  stat,
} from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import {
  PARTITION_JOURNAL_FRAME,
  encodePartitionJournalControl,
  partitionJournalRecoveryReadLimit,
} from "@noobot/session-protocol/partition-journal";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import {
  CommittedJournalDamage,
  journalPartitionPath,
} from "../../src/session/partition-storage/journal-io.js";
import { journalDirectoryPath } from "../../src/session/partition-storage/journal-directory.js";
import { journalOffsetsPath } from "../../src/session/partition-storage/journal-offsets.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { createJournalCase, journalRequest } from "../helpers/partition-journal-cases.js";
import { observeStorageIo } from "../helpers/storage-io-observation.js";

test("recovery rejects old journal formats before opening the journal body", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t);
  await journal.append(journalRequest(journal, 1));
  await journal.close();
  const control = path.join(root, "CURRENT");
  const body = journalPartitionPath(root, 0);
  await appendFile(body, "unpublished suffix");
  const oldBody = await readFile(body);
  for (const version of [55, 65, 66, 67, 71, 74, 75, 76, 77, 78, 79, 80, 81, 82, 93, 94]) {
    const oldControl = Buffer.from(
      encodePartitionJournalControl({
        ...journal.head,
        format: `noobot.partition-journal-prototype/${version}`,
      }),
    );
    await writeFile(control, oldControl);
    const adapter = getFsAdapter();
    setFsAdapter({
      ...adapter,
      async open(file, ...args) {
        assert.notEqual(String(file), body, `Format ${version} opened the journal body`);
        return adapter.open(file, ...args);
      },
    });
    try {
      await assert.rejects(PartitionJournal.open({ root, sessionId }), (error) => {
        assert.ok(error instanceof CommittedJournalDamage);
        assert.equal(error.code, "SESSION_STORAGE_CORRUPT");
        assert.equal(error.cause.code, "SESSION_STORAGE_CORRUPT");
        assert.ok(error.cause.cause instanceof TypeError);
        assert.equal(error.cause.cause.message, "Invalid partition journal identity");
        return true;
      });
    } finally {
      setFsAdapter(adapter);
    }
    assert.deepEqual(await readFile(control), oldControl);
    assert.deepEqual(await readFile(body), oldBody);
  }
});

for (const committed of [false, true]) {
  test(`recovery repeatedly removes the full unpublished batch after ${committed ? "a commit" : "zero commits"}`, async (t) => {
    const { journal, root, sessionId } = await createJournalCase(t, { batchRecords: 4 });
    if (committed) await journal.append(journalRequest(journal, 1));
    await journal.close();
    const tailFile = journalPartitionPath(root, 0);
    await mkdir(path.dirname(tailFile), { recursive: true });
    await appendFile(tailFile, "unpublished suffix");
    for (let index = 1; index <= 4; index += 1) {
      const file = journalPartitionPath(root, index);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "unpublished partition");
    }
    const adapter = getFsAdapter();
    const synced = new Set();
    setFsAdapter({
      ...adapter,
      async open(file, ...args) {
        const handle = await adapter.open(file, ...args);
        return new Proxy(handle, {
          get(target, key) {
            if (key === "sync")
              return async () => {
                synced.add(String(file));
                return target.sync();
              };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    });
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const restored = await PartitionJournal.open({ root, sessionId });
        await restored.close();
        assert.equal(restored.head.sequence, committed ? 1 : 0);
      }
    } finally {
      setFsAdapter(adapter);
    }
    if (committed) assert.equal((await stat(tailFile)).size, journal.head.tail.offset);
    else await assert.rejects(access(tailFile), { code: "ENOENT" });
    for (let index = 1; index <= 4; index += 1)
      await assert.rejects(access(journalPartitionPath(root, index)), { code: "ENOENT" });
    assert.ok(synced.has(path.dirname(path.dirname(tailFile))));
    const restored = await PartitionJournal.open({ root, sessionId });
    t.after(() => restored.close());
    await restored.append(journalRequest(restored, committed ? 2 : 1));
  });
}

test("recovery does not hide directory durability failures", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t);
  await journal.append(journalRequest(journal, 1));
  const adapter = getFsAdapter();
  const parent = path.dirname(path.dirname(journalPartitionPath(root, 0)));
  setFsAdapter({
    ...adapter,
    async open(file, ...args) {
      if (String(file) === parent)
        throw Object.assign(new Error("directory sync failed"), { code: "EIO" });
      return adapter.open(file, ...args);
    },
  });
  try {
    await assert.rejects(PartitionJournal.open({ root, sessionId }), { code: "EIO" });
  } finally {
    setFsAdapter(adapter);
  }
  const restored = await PartitionJournal.open({ root, sessionId });
  t.after(() => restored.close());
  assert.equal(restored.head.sequence, 1);
});

for (const [name, locate] of [
  ["body", journalPartitionPath],
  ["index", journalOffsetsPath],
]) {
  test(`reopen rejects a missing committed tail ${name} without changing CURRENT`, async (t) => {
    const { journal, root, sessionId } = await createJournalCase(t);
    const request = journalRequest(journal, 1);
    const committed = await journal.append(request);
    await journal.close();
    const current = path.join(root, "CURRENT");
    const before = await readFile(current);
    const file = locate(root, journal.head.tail.partition);
    const displaced = path.join(path.dirname(root), `displaced-${name}`);
    await rename(file, displaced);
    await assert.rejects(PartitionJournal.open({ root, sessionId }), (error) => {
      assert.equal(error.code, "SESSION_STORAGE_CORRUPT");
      assert.equal(error.cause?.code, "ENOENT");
      return true;
    });
    assert.deepEqual(await readFile(current), before);
    await assert.rejects(access(file), { code: "ENOENT" });
    await rename(displaced, file);
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const replay = await reopened.append(request);
    assert.deepEqual(replay.cursor, committed.cursor);
    assert.deepEqual(await readFile(current), before);
  });
}

test("a missing sealed body fails paging, point reads and replay as committed damage", async (t) => {
  const { journal, root } = await createJournalCase(
    t,
    { partitionRecords: 1 },
    { autoClose: false },
  );
  const first = journalRequest(journal, 1);
  await journal.append(first);
  await journal.append(journalRequest(journal, 2));
  assert.equal(journal.head.tail.partition, 1);
  const current = path.join(root, "CURRENT");
  const before = await readFile(current);
  const snapshot = await journal.snapshot();
  const body = journalPartitionPath(root, 0);
  const adapter = getFsAdapter();
  const missing = Object.assign(new Error("Missing sealed body"), { code: "ENOENT" });
  const isDamage = (error) => error.code === "SESSION_STORAGE_CORRUPT" && error.cause === missing;
  setFsAdapter({
    ...adapter,
    open(file, flags, ...args) {
      if (String(file) === body && flags === "r") return Promise.reject(missing);
      return adapter.open(file, flags, ...args);
    },
  });
  try {
    await assert.rejects(journal.append(first), isDamage);
    await assert.rejects(journal.readSequencePage({ snapshot, sequence: 1 }), isDamage);
    await assert.rejects(journal.readSequenceRecord({ snapshot, sequence: 1 }), isDamage);
  } finally {
    setFsAdapter(adapter);
    await journal.releaseSnapshot(snapshot);
  }
  assert.deepEqual(await readFile(current), before);
  await assert.rejects(journal.close(), isDamage);
});

for (const [name, locate] of [
  ["START", journalDirectoryPath],
  ["offset index", journalOffsetsPath],
  ["body", journalPartitionPath],
]) {
  test(`cold reads still require the sealed ${name} after snapshot release and receipt expiry`, async (t) => {
    const { journal, root, sessionId } = await createJournalCase(t, {
      partitionRecords: 1,
      receiptRecords: 1,
    });
    const first = journalRequest(journal, 1);
    const committed = await journal.append(first);
    await journal.usingSnapshot(async (snapshot) => {
      await journal.append(journalRequest(journal, 2));
      assert.deepEqual(
        (await journal.readSequencePage({ snapshot, sequence: 1 })).records[0].request,
        first,
      );
    });
    assert.notEqual(journal.head.tail.partition, committed.cursor.partition);
    await assert.rejects(journal.append(first), { code: "SESSION_REQUEST_EXPIRED" });
    await journal.close();

    const current = path.join(root, "CURRENT");
    const before = await readFile(current);
    const file = locate(root, committed.cursor.partition);
    const displaced = path.join(path.dirname(root), "displaced-sealed-file");
    await rename(file, displaced);
    try {
      const reopened = await PartitionJournal.open({ root, sessionId });
      let damage;
      try {
        await reopened.usingSnapshot((snapshot) =>
          assert.rejects(reopened.readSequencePage({ snapshot, sequence: 1 }), (error) => {
            damage = error;
            assert.equal(error.code, "SESSION_STORAGE_CORRUPT");
            assert.equal(error.cause?.code, "ENOENT");
            assert.equal(error.cause.path, file);
            return true;
          }),
        );
      } finally {
        if (damage === undefined) await reopened.close();
        else await assert.rejects(reopened.close(), (error) => error === damage);
      }
      assert.deepEqual(await readFile(current), before);
      await assert.rejects(access(file), { code: "ENOENT" });
    } finally {
      await rename(displaced, file);
    }
    const restored = await PartitionJournal.open({ root, sessionId });
    t.after(() => restored.close());
    await restored.usingSnapshot(async (snapshot) => {
      const page = await restored.readSequencePage({ snapshot, sequence: 1 });
      assert.deepEqual(page.records[0].request, first);
      assert.equal(snapshot.sequence, 2);
    });
    assert.deepEqual(await readFile(current), before);
  });
}

test("a warm writer locates unseen receipts across rollover and reads their bodies on retry", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t, {
    partitionRecords: 3,
    receiptRecords: 3,
  });
  const requests = Array.from({ length: 4 }, (_, index) =>
    journalRequest(journal, index + 1, { delta: "x".repeat(512) }),
  );
  const [, retained] = await Promise.all(
    requests.slice(0, 3).map((request) => journal.append(request)),
  );
  const peer = await PartitionJournal.open({ root, sessionId });
  t.after(() => peer.close());
  const { cursor, end } = await peer.append(requests[3]);
  assert.equal(cursor.partition, 1);
  const { size: controlBytes } = await stat(path.join(root, "CURRENT"));
  const { size: sealedBoundaryBytes } = await stat(journalDirectoryPath(root, 0));
  const before = journal.work.readBytes;
  assert.equal((await journal.append(requests[1])).replayed, true);
  assert.equal(
    journal.work.readBytes - before,
    controlBytes +
      sealedBoundaryBytes +
      PARTITION_JOURNAL_FRAME.offsetBytes +
      retained.end.offset -
      retained.cursor.offset,
  );
  const beforeRetry = journal.work.readBytes;
  assert.equal((await journal.append(requests[3])).replayed, true);
  assert.equal(journal.work.readBytes - beforeRetry, controlBytes + end.offset - cursor.offset);
  await assert.rejects(journal.append(requests[0]), { code: "SESSION_REQUEST_EXPIRED" });
});

for (const warm of [false, true]) {
  test(`${warm ? "warm" : "cold"} retry rejects damage in its committed frame before publication`, async (t) => {
    const { journal, root, sessionId } = await createJournalCase(t, {}, { autoClose: !warm });
    const request = journalRequest(journal, 1);
    const { end } = await journal.append(request);
    const writer = warm ? journal : await PartitionJournal.open({ root, sessionId });
    if (warm) assert.equal((await writer.append(request)).replayed, true);
    const file = journalPartitionPath(root, 0);
    const handle = await open(file, "r+");
    try {
      const position = PARTITION_JOURNAL_FRAME.headerBytes;
      const byte = Buffer.alloc(1);
      assert.equal((await handle.read(byte, 0, 1, position)).bytesRead, 1);
      byte[0] ^= 1;
      await handle.write(byte, 0, 1, position);
    } finally {
      await handle.close();
    }
    const control = path.join(root, "CURRENT");
    const before = await readFile(control);
    await assert.rejects(writer.append(request), { code: "SESSION_STORAGE_CORRUPT" });
    await assert.rejects(writer.append(journalRequest(writer, 2)), {
      code: "SESSION_STORAGE_CORRUPT",
    });
    assert.deepEqual(await readFile(control), before);
    assert.equal((await stat(file)).size, end.offset);
    await assert.rejects(writer.close(), { code: "SESSION_STORAGE_CORRUPT" });
  });
}

test("a stale writer rejects expired requests without reading a receipt body", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t, {
    partitionRecords: 1,
    receiptRecords: 1,
  });
  const first = journalRequest(journal, 1);
  await journal.append(first);
  const peer = await PartitionJournal.open({ root, sessionId });
  t.after(() => peer.close());
  await peer.append(journalRequest(peer, 2));
  await peer.append(journalRequest(peer, 3));
  const latest = journalRequest(peer, 4);
  await peer.append(latest);
  const { size: controlBytes } = await stat(path.join(root, "CURRENT"));
  const before = journal.work.readBytes;
  await assert.rejects(journal.append(first), { code: "SESSION_REQUEST_EXPIRED" });
  assert.equal(journal.work.readBytes - before, controlBytes + PARTITION_JOURNAL_FRAME.offsetBytes);
  assert.equal((await journal.append(latest)).replayed, true);
});

test("cold retry reads window offsets once and only the requested frame", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t, {
    partitionRecords: 3,
    receiptRecords: 6,
    pageRecords: 1,
  });
  const requests = Array.from({ length: 7 }, (_, index) => journalRequest(journal, index + 1));
  for (const request of requests) await journal.append(request);
  await journal.close();
  const { result: reopened, work: openWork } = await observeStorageIo(root, () =>
    PartitionJournal.open({ root, sessionId }),
  );
  t.after(() => reopened.close());
  const control = path.join(root, "CURRENT");
  assert.deepEqual(openWork.readBytesByPath, new Map([["CURRENT", (await stat(control)).size]]));
  assert.equal(reopened.work.partitionOpens, 0);
  const { work } = await observeStorageIo(root, async () => {
    assert.equal((await reopened.append(requests.at(-1))).replayed, true);
  });

  const { head } = reopened;
  assert.equal(head.receiptStart.sequence, 1);
  assert.equal(head.receiptStart.partition, 0);
  assert.equal(head.tail.partition, 2);
  const files = [
    [path.join(root, "CURRENT"), 0],
    [journalDirectoryPath(root, 0), 0],
    [journalDirectoryPath(root, 1), 0],
    [journalOffsetsPath(root, 0), PARTITION_JOURNAL_FRAME.offsetBytes],
    [journalOffsetsPath(root, 1), 0],
    [journalOffsetsPath(root, 2), 0],
    [journalPartitionPath(root, 2), 0],
  ];
  const expected = await Promise.all(
    files.map(async ([file, offset]) => [
      path.relative(root, file),
      (await stat(file)).size - offset,
    ]),
  );
  assert.deepEqual(work.readBytesByPath, new Map(expected));
  assert.equal(reopened.work.partitionOpens, 1);
  assert.ok(work.readBytes <= partitionJournalRecoveryReadLimit(head));
  await assert.rejects(reopened.append(requests[0]), { code: "SESSION_REQUEST_EXPIRED" });
  for (const request of requests.slice(1))
    assert.equal((await reopened.append(request)).replayed, true);
});

test("recovery rejects an oversized cross-partition retry window before reading the excess body", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t, {
    partitionRecords: 1,
    receiptBytes: 4096,
  });
  const payload = { delta: "x".repeat(3000) };
  const first = await journal.append(journalRequest(journal, 1, payload));
  const second = await journal.append(journalRequest(journal, 2, payload));
  assert.equal(second.cursor.partition, 1);
  await journal.close();
  const control = path.join(root, "CURRENT");
  const forged = Buffer.from(
    encodePartitionJournalControl({ ...journal.head, receiptStart: first.cursor }),
  );
  await writeFile(control, forged);

  const body = journalPartitionPath(root, 1);
  const adapter = getFsAdapter();
  let bodyBytes = 0;
  setFsAdapter({
    ...adapter,
    async open(file, ...args) {
      const handle = await adapter.open(file, ...args);
      if (String(file) !== body) return handle;
      return new Proxy(handle, {
        get(target, key) {
          if (key === "read")
            return async (...readArgs) => {
              const result = await target.read(...readArgs);
              bodyBytes += result.bytesRead;
              return result;
            };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  });
  try {
    const reopened = await PartitionJournal.open({ root, sessionId });
    assert.equal(bodyBytes, 0);
    await assert.rejects(reopened.append(journalRequest(reopened, 3)), {
      code: "SESSION_STORAGE_CORRUPT",
      message: "Published retry window exceeds its budget",
    });
    await assert.rejects(reopened.close(), { code: "SESSION_STORAGE_CORRUPT" });
  } finally {
    setFsAdapter(adapter);
  }
  assert.equal(bodyBytes, 0);
  assert.deepEqual(await readFile(control), forged);
});
