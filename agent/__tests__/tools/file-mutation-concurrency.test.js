/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyFileMutation,
  readFileMutation,
  rollbackFileMutation,
} from "../../src/tools/execution/file-mutation-service.js";
import { fileContentSha256 } from "../../src/tools/execution/file-mutation-state.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-mutation-concurrency-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, "file.txt");
  await writeFile(filePath, "base\n");
  return {
    filePath,
    logicalPath: "file.txt",
    mutationRoot: path.join(root, "session-1", "file-mutations"),
    writeText: (target, value) => writeFile(target, value, "utf8"),
  };
}

test("different sessions, turns and logical paths serialize writes to the same physical file", async (t) => {
  const options = await fixture(t);
  let active = 0;
  let peak = 0;
  const writeText = async (target, content) => {
    active += 1;
    peak = Math.max(peak, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      await writeFile(target, content);
    } finally {
      active -= 1;
    }
  };
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, (_, index) =>
      applyFileMutation({
        ...options,
        writeText,
        logicalPath: index % 2 ? options.filePath : options.logicalPath,
        mutationRoot: path.join(
          path.dirname(options.filePath),
          `session-${index}`,
          "file-mutations",
        ),
        operation: index % 2 ? "replace" : "update",
        scopeId: `turn-${index}`,
        content: `writer-${index}\n`,
        expectedSha256: fileContentSha256("base\n"),
      }),
    ),
  );
  assert.equal(peak, 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  for (const result of results.filter((item) => item.status === "rejected"))
    assert.equal(result.reason.code, "file_mutation_conflict");
});

test("rollback refuses a newer aggregate record even when its content is identical", async (t) => {
  const options = {
    ...(await fixture(t)),
    operation: "update",
    scopeId: "turn-1",
    content: "patched\n",
  };
  const restoreState = {};
  const first = await applyFileMutation({ ...options, rollbackState: restoreState });
  await applyFileMutation(options);
  const mutationId = first.mutations[0].id;
  await assert.rejects(rollbackFileMutation({ ...options, mutationId, restoreState }), {
    code: "file_mutation_conflict",
  });
  assert.equal(await readFile(options.filePath, "utf8"), "patched\n");
  const record = await readFileMutation({ ...options, mutationId });
  assert.equal(record.mutations[0].aggregate.revision, 2);
});

test("deleted and recreated files do not poison the aggregate", async (t) => {
  const options = { ...(await fixture(t)), operation: "update", scopeId: "turn-1" };
  const first = await applyFileMutation({ ...options, content: "patched\n" });
  await rm(options.filePath);
  const recreated = await applyFileMutation({ ...options, content: "new\n", expectedSha256: null });
  assert.equal(recreated.mutations[0].id, first.mutations[0].id);
  assert.equal(recreated.mutations[0].aggregate.externalChangeCount, 1);
  assert.equal(await readFile(options.filePath, "utf8"), "new\n");
});
