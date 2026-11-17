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
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableObjectStore } from "../../src/session/session-artifact-session/immutable-object-store.js";
import { ImmutableRecordStore } from "../../src/session/session-artifact-session/immutable-record-store.js";
import { ImmutableLocatedRecordStore } from "../../src/session/session-artifact-session/immutable-located-record-store.js";
import { auditImmutableSnapshot } from "../../src/session/session-artifact-session/immutable-session-audit.js";
import { collectValueRecords } from "./helpers/immutable-record-reads.js";

for (const objectStore of [
  ImmutableObjectStore,
  ImmutableRecordStore,
  ImmutableLocatedRecordStore,
]) {
  test(`${objectStore.name} audit validates shared body once across messages, history and retained readers`, async (t) => {
    const sessionDir = await mkdtemp(path.join(tmpdir(), "audit-content-work-"));
    t.after(() => rm(sessionDir, { recursive: true, force: true }));
    const store = new ImmutableSessionStore({
      sessionDir,
      sessionId: "audit-work",
      allowCreate: true,
      objectStore,
    });
    let body;
    const change = (key, summarized) => ({
      collection: "messages",
      key,
      value: { message: { content: null, summarized } },
      parts: [{ path: ["message", "content"], reference: body }],
    });
    await store.transact({
      expectedGeneration: 0,
      operationId: "seed",
      input: null,
      prepare: async () => {
        body = await store.objects.putValue({ text: "中文🙂".repeat(20000) });
        return { changes: [change("a", false), change("b", false)] };
      },
    });
    const retained = await store.snapshot();
    await store.commit({
      expectedGeneration: 1,
      operationId: "summarize",
      changes: [change("a", true), change("b", true)],
    });
    const snapshot = await store.snapshot();
    const records = await store.objects.withSnapshot(snapshot, () =>
      collectValueRecords(store, body),
    );
    const counts = new Map();
    const read = objectStore.prototype.read;
    t.mock.method(objectStore.prototype, "read", async function (reference) {
      if (records.has(reference)) counts.set(reference, (counts.get(reference) ?? 0) + 1);
      return read.call(this, reference);
    });
    for (let attempt = 1; attempt <= 2; attempt++) {
      const retainedObjects = new Set();
      const result = await auditImmutableSnapshot({
        store,
        snapshot,
        retainedSnapshots: [retained],
        retainedObjects,
      });
      assert.equal(result.ok, true, JSON.stringify(result.issues));
      assert.equal(result.checkedCommits, 2);
      for (const reference of records) {
        assert.equal(
          counts.get(reference),
          attempt,
          `body record must be read once per audit: ${reference}`,
        );
        assert.equal(retainedObjects.has(reference), true);
      }
    }
  });
}
