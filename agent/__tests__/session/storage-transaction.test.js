/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { filePath as path } from "@noobot/path-resolver";
import {
  artifactReadToken,
  invalidateArtifactRead,
  memoizeArtifactRead,
  withSessionStorageTransaction,
} from "../../src/session/session-artifact-session/storage-transaction.js";

test("read tokens follow transaction scope, nesting and teardown", async () => {
  const directory = path.resolve("transaction-scope");
  assert.equal(artifactReadToken(), undefined);
  let first;
  let lateRead;
  await withSessionStorageTransaction(directory, async () => {
    first = artifactReadToken();
    await withSessionStorageTransaction(directory, () => assert.equal(artifactReadToken(), first));
    await withSessionStorageTransaction(path.join(directory, "nested"), () => {
      assert.notEqual(artifactReadToken(), first);
    });
    assert.equal(artifactReadToken(), first);
    lateRead = new Promise((resolve) => setImmediate(() => resolve(artifactReadToken())));
  });
  assert.equal(await lateRead, undefined);
  await withSessionStorageTransaction(directory, () => assert.notEqual(artifactReadToken(), first));
});

test("invalidating a cached path expires derived reads without discarding other file reads", async () => {
  const directory = path.resolve("transaction-invalidation");
  const file = path.join(directory, "snapshot.json");
  const other = path.join(directory, "other.json");
  await withSessionStorageTransaction(directory, async () => {
    const before = artifactReadToken();
    const snapshot = await memoizeArtifactRead("identity", file, () => ({}));
    const retained = await memoizeArtifactRead("identity", other, () => ({}));
    assert.equal(artifactReadToken(), before);
    invalidateArtifactRead(path.join(directory, "absent.json"));
    assert.equal(artifactReadToken(), before);
    invalidateArtifactRead(file);
    assert.notEqual(artifactReadToken(), before);
    assert.notEqual(await memoizeArtifactRead("identity", file, () => ({})), snapshot);
    assert.equal(await memoizeArtifactRead("identity", other, () => ({})), retained);
  });
});

test("in-flight invalidation keeps the expired promise out of subsequent reads", async () => {
  const directory = path.resolve("transaction-pending");
  const file = path.join(directory, "snapshot.json");
  await withSessionStorageTransaction(directory, async () => {
    const token = artifactReadToken();
    let finish;
    const pending = memoizeArtifactRead(
      "identity",
      file,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await Promise.resolve();
    invalidateArtifactRead(file);
    assert.notEqual(artifactReadToken(), token);
    assert.equal(await memoizeArtifactRead("identity", file, () => "new"), "new");
    finish("old");
    assert.equal(await pending, "old");
    assert.equal(await memoizeArtifactRead("identity", file, () => "unexpected"), "new");
  });
});

test("reads outside the transaction directory never enter its memo", async () => {
  const directory = path.resolve("transaction-boundary");
  const file = path.join(`${directory}-other`, "snapshot.json");
  await withSessionStorageTransaction(directory, async () => {
    const token = artifactReadToken();
    const first = await memoizeArtifactRead("identity", file, () => ({}));
    assert.notEqual(await memoizeArtifactRead("identity", file, () => ({})), first);
    invalidateArtifactRead(file);
    assert.equal(artifactReadToken(), token);
  });
});
