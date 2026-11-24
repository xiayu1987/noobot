/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readPersistedJsonFile } from "../../../src/shared/storage/json-file-reader.js";

test("persisted JSON reads the current source and returns independent values", async () => {
  let source = '{"nested":{"value":1}}';
  let reads = 0;
  const readFile = async () => {
    reads += 1;
    return source;
  };
  const options = { filePath: "/snapshot.json", readFile };
  const first = await readPersistedJsonFile(options);
  first.nested.value = 99;
  assert.equal((await readPersistedJsonFile(options)).nested.value, 1);
  assert.equal(reads, 2);
  source = '{"nested":{"value":2}}';
  assert.equal((await readPersistedJsonFile(options)).nested.value, 2);
});

test("persisted JSON reports corruption and distinguishes filesystem failures", async () => {
  const filePath = "/snapshot.json";
  await assert.rejects(readPersistedJsonFile({ filePath, readFile: async () => '{"nested":' }), {
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
        filePath,
        readFile: async () => {
          throw Object.assign(new Error(code), { code });
        },
      }),
      { code: expected },
    );
  }
});
