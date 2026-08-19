/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CONFIG_FILE_ERROR_CODE, readOptionalJsonObjectConfigSync } from "../config-file.js";

test("optional config uses defaults only when the file does not exist", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-config-file-"));
  try {
    const defaults = { enabled: true };
    const result = readOptionalJsonObjectConfigSync({
      filePath: path.join(root, "missing.json"),
      defaultValue: defaults,
    });
    assert.deepEqual(result, defaults);
    assert.notEqual(result, defaults);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("optional config rejects malformed JSON and non-object roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-config-file-"));
  try {
    const malformedPath = path.join(root, "malformed.json");
    const arrayPath = path.join(root, "array.json");
    await writeFile(malformedPath, "{broken", "utf8");
    await writeFile(arrayPath, "[]", "utf8");
    for (const filePath of [malformedPath, arrayPath]) {
      assert.throws(() => readOptionalJsonObjectConfigSync({ filePath }), {
        code: CONFIG_FILE_ERROR_CODE.CORRUPTED,
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("optional config preserves non-missing file read failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-config-file-"));
  try {
    const directoryPath = path.join(root, "config.json");
    await mkdir(directoryPath);
    assert.throws(() => readOptionalJsonObjectConfigSync({ filePath: directoryPath }), {
      code: CONFIG_FILE_ERROR_CODE.READ_FAILED,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
