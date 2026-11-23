/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readPersistedJsonFile } from "../../../src/shared/storage/json-file-reader.js";

test("immutable JSON reuse reads the source every time and rejects corruption and I/O errors", async () => {
  let source = '{"nested":{"value":1}}';
  let reads = 0;
  const readFile = async () => {
    reads += 1;
    return source;
  };
  const options = { filePath: "/snapshot.json", readFile, immutable: true };
  const first = await readPersistedJsonFile(options);
  assert.ok(Object.isFrozen(first.nested));
  assert.throws(() => {
    first.nested.value = 2;
  }, TypeError);
  assert.equal(await readPersistedJsonFile({ ...options, previousValue: first }), first);
  assert.equal(reads, 2);
  source = '{"nested":{"value":2}}';
  const changed = await readPersistedJsonFile({ ...options, previousValue: first });
  assert.notEqual(changed, first);
  assert.equal(changed.nested.value, 2);
  source = '{"nested":';
  await assert.rejects(readPersistedJsonFile({ ...options, previousValue: first }), {
    code: "PERSISTED_JSON_CORRUPTED",
  });
  for (const [code, expected] of [
    ["ENOENT", "PERSISTED_JSON_MISSING"],
    ["ENOTDIR", "PERSISTENCE_IO_FAILED"],
    ["EACCES", "PERSISTENCE_PERMISSION_DENIED"],
    ["EIO", "PERSISTENCE_IO_FAILED"],
  ]) {
    await assert.rejects(
      readPersistedJsonFile({
        ...options,
        previousValue: first,
        readFile: async () => {
          throw Object.assign(new Error(code), { code });
        },
      }),
      { code: expected },
    );
  }
});

test("mutable JSON reads remain independent and cannot authorize immutable reuse", async () => {
  const options = { filePath: "/snapshot.json", readFile: async () => '{"nested":{"value":1}}' };
  const mutable = await readPersistedJsonFile(options);
  mutable.nested.value = 99;
  Object.freeze(mutable);
  const immutable = await readPersistedJsonFile({
    ...options,
    immutable: true,
    previousValue: mutable,
  });
  assert.equal(immutable.nested.value, 1);
  assert.notEqual(immutable, mutable);
  const again = await readPersistedJsonFile({ ...options, previousValue: immutable });
  again.nested.value = 3;
  assert.equal(immutable.nested.value, 1);
});
