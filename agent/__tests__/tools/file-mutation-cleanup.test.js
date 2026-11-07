/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import os from "node:os";
import {
  applyFileMutation,
  rollbackFileMutation,
} from "../../src/tools/execution/file-mutation-service.js";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-cleanup-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, "a");
  await fs.writeFile(filePath, "before");
  return {
    filePath,
    mutationRoot: path.join(root, "records"),
    locator: { view: "workspace", path: "a" },
    sessionScope: null,
    content: "after",
    stageBytes: (target, bytes) => fs.writeFile(target, bytes),
  };
}

function failOperation(t, method, predicate) {
  const original = fs[method];
  t.mock.method(fs, method, async (...args) => {
    if (predicate(...args))
      throw Object.assign(new Error(`injected ${method} failure`), { code: "EACCES" });
    return original(...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
}

test("staging and cleanup failures preserve the main error and report uncommitted state", async (t) => {
  const options = await fixture(t);
  const primary = new Error("staging failed");
  failOperation(t, "rm", (file) => path.basename(file).startsWith(".noobot-mutation-"));
  await assert.rejects(
    applyFileMutation({
      ...options,
      async stageBytes(target, bytes) {
        await fs.writeFile(target, bytes);
        throw primary;
      },
    }),
    (error) => {
      assert.equal(error.cause, primary);
      assert.equal(error.details.targetState, "not_committed");
      assert.equal(error.details.cleanupErrors.length, 1);
      assert.equal(error.details.cleanupErrors[0].code, "EACCES");
      return true;
    },
  );
  assert.equal(await fs.readFile(options.filePath, "utf8"), "before");
});

test("record persistence and cleanup failure report restored bytes", async (t) => {
  const options = await fixture(t);
  failOperation(t, "rename", (_source, target) => target.startsWith(options.mutationRoot));
  failOperation(t, "rm", (file) => file.startsWith(options.mutationRoot));
  await assert.rejects(applyFileMutation(options), (error) => {
    assert.equal(error.code, "file_mutation_commit_failed");
    assert.equal(error.details.targetState, "restored");
    assert.equal(error.details.cleanupErrors.length, 1);
    assert.equal(error.cause.code, "EACCES");
    return true;
  });
  assert.equal(await fs.readFile(options.filePath, "utf8"), "before");
});

test("rollback record removal failure reports restored target and failed cleanup", async (t) => {
  const options = await fixture(t);
  const restoreState = {};
  const result = await applyFileMutation({ ...options, rollbackState: restoreState });
  failOperation(t, "rm", (file) => file.endsWith(`${result.mutations[0].id}.json`));
  await assert.rejects(
    rollbackFileMutation({
      ...options,
      mutationId: result.mutations[0].id,
      restoreState,
    }),
    (error) => {
      assert.equal(error.code, "file_mutation_cleanup_failed");
      assert.equal(error.details.targetState, "restored");
      assert.equal(error.details.cleanupErrors[0].code, "EACCES");
      return true;
    },
  );
  assert.equal(await fs.readFile(options.filePath, "utf8"), "before");
});

test("failed restoration is not mislabeled as an external conflict", async (t) => {
  const options = await fixture(t);
  failOperation(t, "rename", (_source, target) => target.startsWith(options.mutationRoot));
  failOperation(t, "writeFile", (file) => path.basename(file).startsWith(".noobot-atomic-"));
  await assert.rejects(applyFileMutation(options), (error) => {
    assert.equal(error.code, "file_mutation_commit_and_rollback_failed");
    assert.equal(error.details.targetState, "restore_failed");
    return true;
  });
  assert.equal(await fs.readFile(options.filePath, "utf8"), "after");
});

test("restoration and atomic cleanup failures survive JSON serialization", async (t) => {
  const options = await fixture(t);
  failOperation(t, "rename", (_source, target) => target.startsWith(options.mutationRoot));
  failOperation(t, "writeFile", (file) => path.basename(file).startsWith(".noobot-atomic-"));
  failOperation(t, "rm", (file) => path.basename(file).startsWith(".noobot-atomic-"));
  await assert.rejects(applyFileMutation(options), (error) => {
    const details = JSON.parse(JSON.stringify(error.details));
    assert.equal(error.cause.code, "EACCES");
    assert.equal(details.targetState, "restore_failed");
    assert.equal(details.rollbackError.cause.code, "EACCES");
    assert.deepEqual(
      details.rollbackError.errors.map((failure) => failure.code),
      ["EACCES", "EACCES"],
    );
    return true;
  });
  assert.equal(await fs.readFile(options.filePath, "utf8"), "after");
});
