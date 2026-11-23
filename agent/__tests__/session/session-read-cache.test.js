/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { filePath as path } from "@noobot/path-resolver";
import {
  sessionReadToken,
  invalidateSessionRead,
  memoizeSessionRead,
  withSessionReadCache,
} from "../../src/session/session-read-cache.js";

test("read tokens follow read cache scope, nesting and teardown", async () => {
  const directory = path.resolve("read-cache-scope");
  assert.equal(sessionReadToken(), undefined);
  let first;
  let lateRead;
  await withSessionReadCache(directory, async () => {
    first = sessionReadToken();
    await withSessionReadCache(directory, () => assert.equal(sessionReadToken(), first));
    await withSessionReadCache(path.join(directory, "nested"), () => {
      assert.notEqual(sessionReadToken(), first);
    });
    assert.equal(sessionReadToken(), first);
    lateRead = new Promise((resolve) => setImmediate(() => resolve(sessionReadToken())));
  });
  assert.equal(await lateRead, undefined);
  await withSessionReadCache(directory, () => assert.notEqual(sessionReadToken(), first));
});

test("invalidating a cached path expires derived reads without discarding other file reads", async () => {
  const directory = path.resolve("read-cache-invalidation");
  const file = path.join(directory, "snapshot.json");
  const other = path.join(directory, "other.json");
  await withSessionReadCache(directory, async () => {
    const before = sessionReadToken();
    const snapshot = await memoizeSessionRead("identity", file, () => ({}));
    const retained = await memoizeSessionRead("identity", other, () => ({}));
    assert.equal(sessionReadToken(), before);
    invalidateSessionRead(path.join(directory, "absent.json"));
    assert.equal(sessionReadToken(), before);
    invalidateSessionRead(file);
    assert.notEqual(sessionReadToken(), before);
    assert.notEqual(await memoizeSessionRead("identity", file, () => ({})), snapshot);
    assert.equal(await memoizeSessionRead("identity", other, () => ({})), retained);
  });
});

test("in-flight invalidation keeps the expired promise out of subsequent reads", async () => {
  const directory = path.resolve("read-cache-pending");
  const file = path.join(directory, "snapshot.json");
  await withSessionReadCache(directory, async () => {
    const token = sessionReadToken();
    let finish;
    const pending = memoizeSessionRead(
      "identity",
      file,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await Promise.resolve();
    invalidateSessionRead(file);
    assert.notEqual(sessionReadToken(), token);
    assert.equal(await memoizeSessionRead("identity", file, () => "new"), "new");
    finish("old");
    assert.equal(await pending, "old");
    assert.equal(await memoizeSessionRead("identity", file, () => "unexpected"), "new");
  });
});

test("reads outside the read cache directory never enter its memo", async () => {
  const directory = path.resolve("read-cache-boundary");
  const file = path.join(`${directory}-other`, "snapshot.json");
  await withSessionReadCache(directory, async () => {
    const token = sessionReadToken();
    const first = await memoizeSessionRead("identity", file, () => ({}));
    assert.notEqual(await memoizeSessionRead("identity", file, () => ({})), first);
    invalidateSessionRead(file);
    assert.equal(sessionReadToken(), token);
  });
});
