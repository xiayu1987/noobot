/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { executionLogByteBudget, executionLogProjectionIdentity } from "@noobot/session-protocol";
import { createExecutionProjectionReader } from "../../src/session/execution-log-projection-reader.js";

function source(bytes, { shortRead = Infinity, declaredBytes = bytes.length } = {}) {
  const readBatches = createExecutionProjectionReader();
  const reads = [];
  const handle = {
    async read(buffer, offset, length, position) {
      const count = Math.max(0, Math.min(length, shortRead, bytes.length - position));
      bytes.copy(buffer, offset, position, position + count);
      reads.push({ position, bytes: count });
      return { bytesRead: count };
    },
  };
  return {
    reads,
    batches: (offset = 0, snapshot = {}) =>
      readBatches({
        handle,
        segment: { sequence: 1, file: "segment-000001.jsonl", bytes: declaredBytes, ...snapshot },
        dialogProcessId: "d1",
        offset,
        sourceInfo: {
          dev: 1n,
          ino: 1n,
          birthtimeNs: 1n,
          size: BigInt(declaredBytes),
          mtimeNs: 1n,
          ctimeNs: 1n,
        },
      }),
  };
}

const encode = (record) => Buffer.from(`${JSON.stringify({ dialogProcessId: "d1", ...record })}\n`);

function assertReadOnce(reads, start, end) {
  let position = start;
  for (const read of reads) {
    assert.equal(read.position, position);
    position += read.bytes;
  }
  assert.equal(position, end);
}

test("count-limited projection batches read every byte once and keep stable offsets", async () => {
  const records = Array.from({ length: 305 }, (_, number) => encode({ number }));
  const bytes = Buffer.concat(records);
  const input = source(bytes);
  const batches = await Array.fromAsync(input.batches());
  assert.deepEqual(
    batches.map(({ records }) => records.length),
    [100, 100, 100, 5],
  );
  let offset = 0;
  for (const [index, entry] of batches.flatMap(({ records }) => records).entries()) {
    assert.equal(entry.record.number, index);
    assert.equal(entry.sourceId, executionLogProjectionIdentity("d1", 1, offset));
    offset += records[index].length;
  }
  assert.equal(batches.at(-1).end, bytes.length);
  assertReadOnce(input.reads, 0, bytes.length);
});

test("closing each batch retains the bounded window without rereading source bytes", async () => {
  const bytes = Buffer.concat(Array.from({ length: 305 }, (_, number) => encode({ number })));
  const input = source(bytes);
  const delivered = [];
  let offset = 0;
  while (offset < bytes.length) {
    for await (const batch of input.batches(offset)) {
      delivered.push(...batch.records.map(({ record }) => record.number));
      offset = batch.end;
      break;
    }
  }
  assert.deepEqual(
    delivered,
    Array.from({ length: 305 }, (_, number) => number),
  );
  assertReadOnce(input.reads, 0, bytes.length);
});

test("append between lock slices preserves prefetched bytes and enlarges only the bounded window", async () => {
  const prefix = Buffer.concat(Array.from({ length: 205 }, (_, number) => encode({ number })));
  const bytes = Buffer.concat([
    prefix,
    encode({ number: 205, text: "x".repeat(prefix.length * 2) }),
  ]);
  const input = source(bytes, { shortRead: 997 });
  const delivered = [];
  let offset;
  for await (const batch of input.batches(0, { bytes: prefix.length })) {
    delivered.push(...batch.records);
    offset = batch.end;
    break;
  }
  while (offset < bytes.length) {
    for await (const batch of input.batches(offset)) {
      delivered.push(...batch.records);
      offset = batch.end;
      break;
    }
  }
  assert.deepEqual(
    delivered.map(({ record }) => record.number),
    Array.from({ length: 206 }, (_, number) => number),
  );
  assertReadOnce(input.reads, 0, bytes.length);
});

test("unacknowledged delivery resets the window to the durable cursor", async () => {
  const bytes = Buffer.concat(Array.from({ length: 205 }, (_, number) => encode({ number })));
  const input = source(bytes);
  let attempted;
  for await (const batch of input.batches()) {
    attempted = batch;
    break;
  }
  const replay = await input.batches(0).next();
  assert.deepEqual(replay.value, attempted);
  assert.equal(input.reads[1].position, 0);
});

for (const snapshot of [{ sequence: 2 }, { file: "segment-000002.jsonl" }, { shortened: true }]) {
  test(`changed source snapshot discards prefetched bytes (${JSON.stringify(snapshot)})`, async () => {
    const records = Array.from({ length: 205 }, (_, number) => encode({ number }));
    const input = source(Buffer.concat(records));
    let offset;
    for await (const batch of input.batches()) {
      offset = batch.end;
      break;
    }
    const changed = snapshot.shortened
      ? { bytes: Buffer.concat(records.slice(0, 150)).length }
      : snapshot;
    const readCount = input.reads.length;
    const delivered = await Array.fromAsync(input.batches(offset, changed));
    assert.equal(input.reads[readCount].position, offset);
    assert.deepEqual(
      delivered.flatMap(({ records }) => records.map(({ record }) => record.number)),
      Array.from({ length: snapshot.shortened ? 50 : 105 }, (_, index) => index + 100),
    );
    assert.equal(
      delivered[0].records[0].sourceId,
      executionLogProjectionIdentity("d1", changed.sequence ?? 1, offset),
    );
  });
}

test("window boundaries, UTF-8 and short reads retain the unconsumed source suffix", async () => {
  const limit = executionLogByteBudget().batchBytes;
  const records = Array.from({ length: 7 }, (_, number) =>
    encode({ number, text: "汉".repeat(Math.floor(limit / 9)) }),
  );
  const bytes = Buffer.concat(records);
  const input = source(bytes, { shortRead: 997 });
  const batches = await Array.fromAsync(input.batches(records[0].length));
  assert.deepEqual(
    batches.flatMap(({ records }) => records.map(({ record }) => record.number)),
    [1, 2, 3, 4, 5, 6],
  );
  let previous = records[0].length;
  for (const batch of batches) {
    assert.ok(batch.end - previous <= limit);
    previous = batch.end;
  }
  assertReadOnce(input.reads, records[0].length, bytes.length);
});

test("an exact-budget record is accepted while an oversized or torn record is rejected", async () => {
  const limit = executionLogByteBudget().batchBytes;
  const overhead = encode({ text: "" }).length;
  const exact = encode({ text: "x".repeat(limit - overhead) });
  assert.equal(exact.length, limit);
  assert.equal((await Array.fromAsync(source(exact).batches())).length, 1);
  await assert.rejects(
    Array.fromAsync(source(encode({ text: "x".repeat(limit - overhead + 1) })).batches()),
    /exceeds byte budget/,
  );
  await assert.rejects(Array.fromAsync(source(exact.subarray(0, -1)).batches()), /torn/);
});

test("truncated, malformed, invalid UTF-8 and foreign-turn source bytes fail explicitly", async () => {
  const valid = encode({ value: 1 });
  await assert.rejects(
    Array.fromAsync(source(valid, { declaredBytes: valid.length + 1 }).batches()),
    /truncated/,
  );
  await assert.rejects(
    Array.fromAsync(source(Buffer.from("{broken}\n")).batches()),
    /invalid JSONL/,
  );
  await assert.rejects(Array.fromAsync(source(Buffer.from([0xff, 10])).batches()), /invalid UTF-8/);
  await assert.rejects(
    Array.fromAsync(source(Buffer.from('{"dialogProcessId":"other"}\n')).batches()),
    /different turn/,
  );
});

test("delivery cancellation reads no subsequent window and restart uses the acknowledged offset", async () => {
  const limit = executionLogByteBudget().batchBytes;
  const bytes = Buffer.concat(
    Array.from({ length: 5 }, () => encode({ text: "x".repeat(Math.floor(limit / 2)) })),
  );
  const input = source(bytes);
  const iterator = input.batches();
  const first = (await iterator.next()).value;
  const readBytes = input.reads.reduce((sum, read) => sum + read.bytes, 0);
  await iterator.return();
  assert.equal(
    input.reads.reduce((sum, read) => sum + read.bytes, 0),
    readBytes,
  );
  assert.ok(readBytes < bytes.length);
  const restarted = source(bytes);
  const remaining = await Array.fromAsync(restarted.batches(first.end));
  assert.equal(remaining.flatMap(({ records }) => records).length + first.records.length, 5);
  assertReadOnce(restarted.reads, first.end, bytes.length);
});

test("reopened same-name same-size source cannot reuse bytes from the replaced inode", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projection-source-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "segment-000001.jsonl");
  const original = Buffer.concat(
    Array.from({ length: 205 }, (_, number) => encode({ number, value: "old" })),
  );
  const replacement = Buffer.from(original.toString().replaceAll('"old"', '"new"'));
  assert.equal(original.length, replacement.length);
  await writeFile(file, original);
  const reader = createExecutionProjectionReader();
  const segment = { sequence: 1, file: path.basename(file), bytes: original.length };
  let offset;
  const first = await open(file, "r");
  try {
    for await (const batch of reader({
      handle: first,
      segment,
      dialogProcessId: "d1",
      offset: 0,
      sourceInfo: await first.stat({ bigint: true }),
    })) {
      offset = batch.end;
      break;
    }
  } finally {
    await first.close();
  }
  const staged = path.join(directory, "replacement");
  await writeFile(staged, replacement);
  await rename(staged, file);
  const reopened = await open(file, "r");
  try {
    const batches = await Array.fromAsync(
      reader({
        handle: reopened,
        segment,
        dialogProcessId: "d1",
        offset,
        sourceInfo: await reopened.stat({ bigint: true }),
      }),
    );
    const records = batches.flatMap(({ records }) => records.map(({ record }) => record));
    assert.equal(records.length, 105);
    assert.ok(records.every(({ value }) => value === "new"));
  } finally {
    await reopened.close();
  }
});

for (const append of [false, true]) {
  test(`in-place source revision invalidates prefetched bytes (append=${append})`, async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "projection-revision-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, "segment-000001.jsonl");
    const original = Buffer.concat(
      Array.from({ length: 205 }, (_, number) => encode({ number, value: "old" })),
    );
    await writeFile(file, original);
    const reader = createExecutionProjectionReader();
    const segment = { sequence: 1, file: path.basename(file), bytes: original.length };
    const handle = await open(file, "r+");
    try {
      const initial = await handle.stat({ bigint: true });
      let offset;
      for await (const batch of reader({
        handle,
        segment,
        dialogProcessId: "d1",
        offset: 0,
        sourceInfo: initial,
      })) {
        offset = batch.end;
        break;
      }
      const suffix = Buffer.concat([
        ...Array.from({ length: 105 }, (_, index) => encode({ number: index + 100, value: "new" })),
        ...(append ? [encode({ number: 205, value: "new" })] : []),
      ]);
      await handle.write(suffix, 0, suffix.length, offset);
      await handle.utimes(new Date(), new Date(Number(initial.mtimeMs) + 1000));
      await handle.sync();
      const revised = await handle.stat({ bigint: true });
      assert.equal(revised.ino, initial.ino);
      assert.equal(revised.birthtimeNs, initial.birthtimeNs);
      assert.notEqual(revised.mtimeNs, initial.mtimeNs);
      const batches = await Array.fromAsync(
        reader({
          handle,
          segment: { ...segment, bytes: Number(revised.size) },
          dialogProcessId: "d1",
          offset,
          sourceInfo: revised,
        }),
      );
      const records = batches.flatMap(({ records }) => records.map(({ record }) => record));
      assert.deepEqual(
        records,
        Array.from({ length: append ? 106 : 105 }, (_, index) => ({
          dialogProcessId: "d1",
          number: index + 100,
          value: "new",
        })),
      );
      assert.equal(batches[0].records[0].sourceId, executionLogProjectionIdentity("d1", 1, offset));
    } finally {
      await handle.close();
    }
  });
}

test("a real append resumes at the durable offset and rereads only the bounded pending window", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projection-append-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "segment-000001.jsonl");
  const original = Buffer.concat(Array.from({ length: 205 }, (_, number) => encode({ number })));
  await writeFile(file, original);
  const reader = createExecutionProjectionReader();
  const segment = { sequence: 1, file: path.basename(file), bytes: original.length };
  const handle = await open(file, "r+");
  try {
    let offset;
    for await (const batch of reader({
      handle,
      segment,
      dialogProcessId: "d1",
      offset: 0,
      sourceInfo: await handle.stat({ bigint: true }),
    })) {
      offset = batch.end;
      break;
    }
    const appended = encode({ number: 205 });
    await handle.write(appended, 0, appended.length, original.length);
    const info = await handle.stat({ bigint: true });
    const reads = [];
    const observed = {
      async read(buffer, start, length, position) {
        const result = await handle.read(buffer, start, length, position);
        reads.push({ position, bytes: result.bytesRead });
        return result;
      },
    };
    const batches = await Array.fromAsync(
      reader({
        handle: observed,
        segment: {
          ...segment,
          bytes: Number(info.size),
        },
        dialogProcessId: "d1",
        offset,
        sourceInfo: info,
      }),
    );
    assert.deepEqual(
      batches.flatMap(({ records }) => records.map(({ record }) => record.number)),
      Array.from({ length: 106 }, (_, index) => index + 100),
    );
    assertReadOnce(reads, offset, Number(info.size));
    assert.ok(
      reads.reduce((sum, read) => sum + read.bytes, 0) <= executionLogByteBudget().batchBytes,
    );
    assert.equal(batches[0].records[0].sourceId, executionLogProjectionIdentity("d1", 1, offset));
  } finally {
    await handle.close();
  }
});

test("projection rejects a missing opened-file identity before reading source bytes", async () => {
  const reader = createExecutionProjectionReader();
  const handle = {
    async read() {
      assert.fail("unidentified source must not be read");
    },
  };
  await assert.rejects(
    Array.fromAsync(
      reader({
        handle,
        segment: { sequence: 1, file: "source.jsonl", bytes: 1 },
        dialogProcessId: "d1",
        offset: 0,
      }),
    ),
    /requires the opened source file identity/,
  );
});
