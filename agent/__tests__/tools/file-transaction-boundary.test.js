/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyFileMutation } from "../../src/tools/execution/file-mutation-service.js";

async function fixture(t, exists) {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-transaction-boundary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, "a");
  const before = Buffer.from("\uFEFF原始\r\n", "utf16le");
  if (exists) await writeFile(filePath, before);
  const options = {
    filePath,
    locator: { view: "workspace", path: "a" },
    mutationRoot: path.join(root, "records"),
    sessionScope: null,
    content: "after\n",
  };
  return { root, before, options };
}

for (const exists of [true, false]) {
  for (const fault of ["throw-after-write", "wrong-bytes", "throw-before-write"]) {
    test(`staging ${fault} leaves target untouched (exists=${exists})`, async (t) => {
      const { root, before, options } = await fixture(t, exists);
      await assert.rejects(
        applyFileMutation({
          ...options,
          async stageBytes(stagedPath, content) {
            assert.notEqual(stagedPath, options.filePath);
            assert.equal(path.dirname(stagedPath), root);
            if (fault === "throw-before-write") throw new Error(fault);
            await writeFile(stagedPath, fault === "wrong-bytes" ? "corrupt" : content);
            if (fault === "throw-after-write") throw new Error(fault);
          },
        }),
        { code: "file_mutation_commit_failed" },
      );
      if (exists) assert.deepEqual(await readFile(options.filePath), before);
      else await assert.rejects(readFile(options.filePath), { code: "ENOENT" });
      assert.deepEqual(await readdir(options.mutationRoot), []);
      assert.deepEqual((await readdir(root)).sort(), exists ? ["a", "records"] : ["records"]);
    });
  }
}

test("target is checked again after staging and external bytes are preserved", async (t) => {
  const { root, options } = await fixture(t, true);
  await assert.rejects(
    applyFileMutation({
      ...options,
      async stageBytes(stagedPath, content) {
        await writeFile(stagedPath, content);
        await writeFile(options.filePath, "external\n");
      },
    }),
    (error) => {
      assert.equal(error.code, "file_mutation_commit_failed");
      assert.equal(error.cause.code, "file_mutation_conflict");
      return true;
    },
  );
  assert.equal(await readFile(options.filePath, "utf8"), "external\n");
  assert.deepEqual(await readdir(root), ["a", "records"]);
});
