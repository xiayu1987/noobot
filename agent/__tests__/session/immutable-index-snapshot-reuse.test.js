/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableLocatedRecordStore } from "../../src/session/session-artifact-session/immutable-located-record-store.js";
import { IMMUTABLE_LOCATED_SESSION_FORMAT } from "@noobot/session-protocol/immutable-record-location";
import { observeSessionStorageWork } from "../../src/session/session-storage-observation.js";

test("verified index pages reuse their physical identity across locator roots while enforcing snapshot membership", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "index-snapshot-reuse-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const writer = new ImmutableLocatedRecordStore(directory);
  const empty = {
    format: IMMUTABLE_LOCATED_SESSION_FORMAT,
    generation: 0,
    ...writer.initialHeadFields(),
  };
  let root;
  const first = await writer.withDurabilityBatch(async () => {
    writer.beginCommit(empty);
    const value = await writer.putValue("original");
    root = await writer.putIndexPage({ kind: "index-leaf", entries: [["key", value]] }, "");
    await writer.publishReachable([root]);
    return { ...empty, generation: 1, ...writer.publicationHeadFields() };
  });
  const next = await writer.withDurabilityBatch(async () => {
    writer.beginCommit(first);
    const unrelated = await writer.putValue("unrelated");
    await writer.publishReachable([root, unrelated]);
    return { ...first, generation: 2, ...writer.publicationHeadFields() };
  });
  assert.notEqual(first.locationRoot, next.locationRoot);
  const reader = new ImmutableLocatedRecordStore(directory);
  await reader.withReadScope(async () => {
    await reader.locateRecords(first.locationRoot, [root]);
    await reader.locateRecords(next.locationRoot, [root]);
    const initial = await observeSessionStorageWork(() =>
      reader.withSnapshot(first, () => reader.readIndexPage(root, "")),
    );
    const reused = await observeSessionStorageWork(() =>
      reader.withSnapshot(next, () => reader.readIndexPage(root, "")),
    );
    assert.equal(initial.work.immutableIndexPageReads, 1);
    assert.equal(reused.work.immutableIndexPageReads ?? 0, 0);
    assert.equal(initial.result, reused.result);
    await assert.rejects(
      reader.withSnapshot(empty, () => reader.readIndexPage(root, "")),
      /location is missing/,
    );
    await assert.rejects(
      reader.withSnapshot(next, () => reader.readIndexPage(root, "f")),
      /hash path/,
    );
  });
  const cold = await observeSessionStorageWork(() =>
    reader.withSnapshot(next, () => reader.readIndexPage(root, "")),
  );
  assert.ok(cold.work.immutableIndexPageReads > 0);
});
