/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile, readFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { immutableOfflineBackend } from "../../src/session/session-artifact-session/immutable-storage-backends.js";
import { ImmutableSegmentStore } from "../../src/session/session-artifact-session/immutable-segment-store.js";
import { migrateImmutableSessionSegments } from "../../src/session/session-artifact-session/immutable-segment-migration.js";
import { auditImmutableSession } from "../../src/session/session-artifact-session/immutable-session-audit.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  IMMUTABLE_JSON_LOCATED_SESSION_FORMAT,
  IMMUTABLE_LOCATED_SESSION_FORMAT,
} from "@noobot/session-protocol/immutable-record-location";
import { encodeImmutableSessionHead } from "@noobot/session-protocol/immutable-storage";

async function legacyFixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "compact-upgrade-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  t.after(resetFsAdapter);
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "upgrade", allowCreate: true });
  const request = {
    expectedGeneration: 0,
    operationId: "seed",
    changes: [
      { collection: "messages", key: "m1", value: { content: "long history".repeat(8000) } },
    ],
  };
  await store.commit(request);
  await store.commit({
    expectedGeneration: 1,
    operationId: "update",
    changes: [{ collection: "metadata", key: "title", value: "current" }],
  });
  const head = await store.snapshot();
  const batch = new ImmutableSegmentStore(sessionDir).createBatch(head.segmentTail);
  try {
    async function translate(reference, prefix) {
      const page = structuredClone(await store.objects.locations.readPage(reference, prefix));
      if (page.kind === "index-branch")
        for (const digit of Object.keys(page.children))
          page.children[digit] = await translate(page.children[digit], prefix + digit);
      return batch.stage(Buffer.from(JSON.stringify(page)));
    }
    const locationRoot = await store.objects.withSnapshot(head, () =>
      translate(head.locationRoot, ""),
    );
    await batch.publish([...batch.records.keys()]);
    const legacy = {
      ...head,
      locationRoot,
      segmentTail: batch.tail,
      format: IMMUTABLE_JSON_LOCATED_SESSION_FORMAT,
    };
    await writeFile(store.headPath, encodeImmutableSessionHead(legacy, legacy.format));
  } finally {
    batch.release();
  }
  return { sessionDir, request, headPath: store.headPath };
}

for (const failPublication of [false, true]) {
  test(`v4 locator upgrade preserves history and retry identity${failPublication ? " after failed publication" : ""}`, async (t) => {
    const { sessionDir, request, headPath } = await legacyFixture(t);
    await assert.rejects(ImmutableSessionStore.open({ sessionDir }), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
    const source = await ImmutableSessionStore.open({
      sessionDir,
      objectStore: immutableOfflineBackend(IMMUTABLE_JSON_LOCATED_SESSION_FORMAT),
    });
    const original = await readFile(headPath);
    assert.equal(
      (
        await source.readCommitChanges(await source.snapshot(), {
          generation: 1,
          collections: ["messages"],
        })
      ).changes[0].value.content.length,
      96000,
    );
    await assert.rejects(
      source.commit({ expectedGeneration: 2, operationId: "forbidden", changes: [] }),
      /read-only/,
    );
    if (failPublication) {
      const failure = new Error("head publication rejected");
      setFsAdapter({
        rename: async (from, to) => {
          if (to === headPath) throw failure;
          return rename(from, to);
        },
      });
      await assert.rejects(
        migrateImmutableSessionSegments({ sessionDir }),
        (error) => error === failure,
      );
      resetFsAdapter();
      assert.deepEqual(await readFile(headPath), original);
      assert.equal(await source.get(await source.snapshot(), "metadata", "title"), "current");
    }
    await migrateImmutableSessionSegments({ sessionDir });
    const target = await ImmutableSessionStore.open({ sessionDir });
    const head = await target.snapshot();
    assert.equal(head.format, IMMUTABLE_LOCATED_SESSION_FORMAT);
    assert.equal(head.generation, 2);
    assert.equal((await target.commit(request)).replayed, true);
    assert.equal(
      (await target.readCommitChanges(head, { generation: 1, collections: ["messages"] }))
        .changes[0].value.content.length,
      96000,
    );
    const report = await auditImmutableSession({ sessionDir });
    assert.equal(report.ok, true, JSON.stringify(report.issues));
    await target.commit({
      expectedGeneration: 2,
      operationId: "after",
      changes: [{ collection: "metadata", key: "title", value: "after" }],
    });
    assert.equal(await target.get(head, "metadata", "title"), "current");
    const before = await readFile(headPath);
    await migrateImmutableSessionSegments({ sessionDir });
    assert.deepEqual(await readFile(headPath), before);
  });
}
