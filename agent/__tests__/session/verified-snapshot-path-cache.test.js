/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createVerifiedSnapshotCache } from "../../src/session/session-artifact-session/verified-snapshot-cache.js";

const pathKey = (directory, file) => JSON.stringify(["snapshotPath", "", directory, file]);

test("snapshot path keys distinguish directory and reference boundaries", () => {
  const cache = createVerifiedSnapshotCache({ payloadByteBudget: 0, identityByteBudget: 4096 });
  const options = [
    ["/session/a", "b|c.json"],
    ["/session/a|b", "c.json"],
    ["/session/a", "b,c.json"],
    ["/session/a,b", "c.json"],
    ["/session/a", "b\nc.json"],
  ];
  let resolved = 0;
  const paths = options.map(([directory, file]) =>
    cache.resolvePath(pathKey(directory, file), () => {
      resolved++;
      return `${directory}/${file}`;
    }),
  );
  assert.equal(new Set(paths).size, options.length);
  for (const [index, [directory, file]] of options.entries()) {
    assert.equal(
      cache.resolvePath(pathKey(directory, file), () => {
        throw new Error("unexpected path resolution");
      }),
      paths[index],
    );
  }
  assert.equal(resolved, options.length);
});

test("snapshot paths share the identity budget and rebuild after eviction", () => {
  const cache = createVerifiedSnapshotCache({ payloadByteBudget: 0, identityByteBudget: 256 });
  const key = pathKey("/session/old", "snapshots/checkpoint.json");
  let resolutions = 0;
  const resolve = () => {
    resolutions++;
    return "/session/old/snapshots/checkpoint.json";
  };
  assert.equal(cache.resolvePath(key, resolve), "/session/old/snapshots/checkpoint.json");
  assert.equal(cache.resolvePath(key, resolve), "/session/old/snapshots/checkpoint.json");
  assert.equal(resolutions, 1);
  for (let index = 0; index < 20; index++) {
    const directory = `/session/pressure-${index}`;
    cache.resolvePath(pathKey(directory, "snapshot.json"), () => `${directory}/snapshot.json`);
    cache.resolvePath(pathKey(directory, "snapshot.json"), () => {
      throw new Error("pressure entry must be retained");
    });
    assert.ok(cache.cachedBytes().identity <= 256);
  }
  assert.equal(cache.resolvePath(key, resolve), "/session/old/snapshots/checkpoint.json");
  assert.equal(resolutions, 2);
  assert.ok(cache.cachedBytes().identity <= 256);
  assert.equal(cache.cachedBytes().payload, 0);
});

test("oversized snapshot paths are resolved without being retained", () => {
  const cache = createVerifiedSnapshotCache({ payloadByteBudget: 0, identityByteBudget: 1 });
  let resolutions = 0;
  const key = pathKey("/session/a", "snapshot.json");
  const resolve = () => {
    resolutions++;
    return "/session/a/snapshot.json";
  };
  assert.equal(cache.resolvePath(key, resolve), "/session/a/snapshot.json");
  assert.equal(cache.resolvePath(key, resolve), "/session/a/snapshot.json");
  assert.equal(resolutions, 2);
  assert.deepEqual(cache.cachedBytes(), { identity: 0, payload: 0 });
});
