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
import { ImmutableLocatedRecordStore } from "../../src/session/session-artifact-session/immutable-located-record-store.js";
import { ImmutableSegmentStore } from "../../src/session/session-artifact-session/immutable-segment-store.js";
import { auditImmutableSession } from "../../src/session/session-artifact-session/immutable-session-audit.js";

async function fixture(context) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-audit-cancel-"));
  context.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "session", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "initial",
    changes: [{ collection: "messages", key: "large", value: "x".repeat(400000) }],
  });
  const snapshot = await store.snapshot();
  return store.objects.withSnapshot(snapshot, async () => {
    const root = await store.index.get(snapshot.root, "messages");
    const reference = await store.index.get(root, "large");
    let page = await store.objects.readPage(reference);
    while (page.kind === "value-branch") page = await store.objects.readPage(page.left);
    return { sessionDir, reference, firstData: page.data, store, snapshot };
  });
}

for (const overlay of [false, true]) {
  test(`audit stops inside a multi-block value and preserves cancellation reason (overlay=${overlay})`, async (context) => {
    const { sessionDir, reference, firstData, store, snapshot } = await fixture(context);
    const controller = new AbortController();
    const reason = new Error("audit cancelled during value read");
    const read = ImmutableLocatedRecordStore.prototype.read;
    let readsAfterCancellation = 0;
    let segmentReadsAfterCancellation = 0;
    const readSegment = ImmutableSegmentStore.prototype.read;
    context.mock.method(ImmutableSegmentStore.prototype, "read", function (target) {
      if (controller.signal.aborted) segmentReadsAfterCancellation += 1;
      return readSegment.call(this, target);
    });
    let cancelled = false;
    context.mock.method(ImmutableLocatedRecordStore.prototype, "read", async function (target) {
      if (controller.signal.aborted) readsAfterCancellation += 1;
      const bytes = await read.call(this, target);
      if (target === firstData) {
        cancelled = true;
        controller.abort(reason);
      }
      return bytes;
    });
    const objectOverrides = overlay
      ? new Map([
          [
            reference,
            await store.objects.withSnapshot(snapshot, () => read.call(store.objects, reference)),
          ],
        ])
      : undefined;
    await assert.rejects(
      auditImmutableSession({ sessionDir, signal: controller.signal, objectOverrides }),
      (error) => error === reason,
    );
    assert.equal(cancelled, true);
    assert.equal(readsAfterCancellation, 0);
    assert.equal(segmentReadsAfterCancellation, 0);
  });
}

test("audit yields within a multi-block value when all reads use repair overlays", async (context) => {
  const { sessionDir, reference } = await fixture(context);
  const objects = new Map();
  const read = ImmutableLocatedRecordStore.prototype.read;
  const capture = context.mock.method(
    ImmutableLocatedRecordStore.prototype,
    "read",
    async function (target) {
      const bytes = await read.call(this, target);
      objects.set(target, bytes);
      return bytes;
    },
  );
  assert.equal((await auditImmutableSession({ sessionDir })).ok, true);
  capture.mock.restore();
  const controller = new AbortController();
  const reason = new Error("cancel overlay traversal on the next event-loop turn");
  let scheduled = false;
  let readsBeforeYield = 0;
  class CancellableOverlay extends Map {
    get(target) {
      if (scheduled) readsBeforeYield += 1;
      if (target === reference && !scheduled) {
        scheduled = true;
        setImmediate(() => controller.abort(reason));
      }
      return super.get(target);
    }
  }
  await assert.rejects(
    auditImmutableSession({
      sessionDir,
      batchSize: 1,
      signal: controller.signal,
      objectOverrides: new CancellableOverlay(objects),
    }),
    (error) => error === reason,
  );
  assert.equal(scheduled, true);
  assert.equal(readsBeforeYield, 0);
});
