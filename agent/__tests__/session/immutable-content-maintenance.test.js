/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { immutablePageReferences } from "@noobot/session-protocol/immutable-storage-graph";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { auditImmutableSession } from "../../src/session/session-artifact-session/immutable-session-audit.js";
import { acquireImmutableReaderRetention } from "../../src/session/session-artifact-session/immutable-reader-retention.js";
import {
  cleanupSessionArtifacts,
  discardSessionArtifactCleanup,
  repairSessionArtifacts,
} from "../../src/session/session-artifact-maintenance.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { prepareSessionArtifactCleanupToCompletion as prepareSessionArtifactCleanup } from "../helpers/immutable-cleanup.js";
import { decodeImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";
import {
  corruptRecord,
  committedPhysicalRecord,
  publishOrphanRecord,
  readCommittedRecord,
} from "./helpers/immutable-record-reads.js";

async function createFixture(t, layout) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-content-maintenance-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "content", allowCreate: true });
  const content = [
    { type: "text", text: 'abcdefgh"\\\n'.repeat(LENGTH_THRESHOLDS.immutableStorage.blockBytes) },
    { type: "tool_result", result: { value: [null, false, { nested: "preserved" }] } },
  ];
  const value = { message: { messageUid: "m", content, summarized: false } };
  if (layout === "value-parts")
    value.metadata = "m".repeat(LENGTH_THRESHOLDS.immutableStorage.blockBytes);
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [{ collection: "messages", key: "m", value }],
  });
  const snapshot = await store.snapshot();
  const { reference, page } = await store.objects.withSnapshot(snapshot, async () => {
    const root = await store.index.get(snapshot.root, "messages");
    const reference = await store.index.get(root, "m");
    return { reference, page: await store.objects.readPage(reference) };
  });
  assert.equal(page.kind, layout, "exercise the selected metadata layout with independent content");
  const options = { storageService, sessionDir, assertSessionWritable: async () => {} };
  return { store, sessionDir, snapshot, reference, page, value, options };
}

async function valueObjects(store, reference, objects = new Map()) {
  if (objects.has(reference)) return objects;
  const bytes = await readCommittedRecord(store, reference);
  const page = JSON.parse(bytes.toString("utf8"));
  objects.set(reference, { bytes, kind: page.kind });
  if (page.kind === "value") {
    const data = await readCommittedRecord(store, page.data);
    objects.set(page.data, { bytes: data, kind: "data" });
  } else {
    for (const child of immutablePageReferences(page, store.requireReference))
      await valueObjects(store, child, objects);
  }
  return objects;
}

for (const layout of ["value-parts", "value-parts-inline"]) {
  describe(layout, () => {
    const fixture = (t) => createFixture(t, layout);

    test("content references are retained through audit, cleanup, reopen and historical replay", async (t) => {
      const { store, sessionDir, snapshot, reference, value, options } = await fixture(t);
      const retention = await acquireImmutableReaderRetention(store, async () => {});
      await using retainedReader = { [Symbol.asyncDispose]: retention.release };
      assert.equal(retainedReader[Symbol.asyncDispose], retention.release);
      const originalObjects = await valueObjects(store, reference);
      await store.commit({
        expectedGeneration: 1,
        operationId: "replace-content",
        changes: [{ collection: "messages", key: "m", value: { message: { content: "new" } } }],
      });
      const orphan = await publishOrphanRecord(store, Buffer.from("uncommitted"));
      const retainedObjects = new Set();
      const audit = await auditImmutableSession({ sessionDir, retainedObjects });
      assert.equal(audit.ok, true, JSON.stringify(audit));
      for (const object of originalObjects.keys()) assert.equal(retainedObjects.has(object), true);
      const plan = await prepareSessionArtifactCleanup({ ...options, dryRun: false });
      const result = await cleanupSessionArtifacts({ ...options, planId: plan.planId });
      assert.equal(result.complete, true);
      await discardSessionArtifactCleanup({ ...options, planId: plan.planId });
      await assert.rejects(store.objects.segments.read(orphan), {
        code: "SESSION_IMMUTABLE_STORAGE_INVALID",
      });
      const reopened = await ImmutableSessionStore.open({ sessionDir });
      assert.deepEqual(await reopened.get(snapshot, "messages", "m"), value);
      assert.deepEqual(await reopened.get(await reopened.snapshot(), "messages", "m"), {
        message: { content: "new" },
      });
      const replay = await reopened.readCommitChanges(await reopened.snapshot(), {
        generation: 1,
        collections: ["messages"],
      });
      assert.deepEqual(replay.changes, [{ collection: "messages", key: "m", value }]);
    });

    for (const kind of [layout, "value-branch", "value", "data"]) {
      for (const damage of ["missing", "checksum"]) {
        test(`${damage} content ${kind} rejects reads and audit, survives cleanup, and is repairable`, async (t) => {
          const { store, sessionDir, snapshot, reference, value, options } = await fixture(t);
          const objects = await valueObjects(store, reference);
          const entry = [...objects].find(([, object]) => object.kind === kind);
          assert.ok(entry, `fixture must contain ${kind}`);
          const [damagedReference, { bytes }] = entry;
          const segmentId = (await committedPhysicalRecord(store, damagedReference)).segmentId;
          const file = store.objects.segments.segmentPath(segmentId);
          let replacements = [{ reference: damagedReference, bytes }];
          if (damage === "missing") {
            const evidence = new Map();
            for await (const location of store.objects.physicalReferences(snapshot)) {
              const record = decodeImmutableRecordReference(location);
              if (record.segmentId === segmentId)
                evidence.set(record.digest, await store.objects.segments.read(location));
            }
            replacements = [...evidence].map(([reference, bytes]) => ({ reference, bytes }));
          }
          const head = await readFile(store.headPath);
          if (damage === "missing") await rm(file);
          else await corruptRecord(store, damagedReference);
          await assert.rejects(store.get(snapshot, "messages", "m"), {
            code: "SESSION_IMMUTABLE_STORAGE_INVALID",
          });
          const audit = await auditImmutableSession({ sessionDir });
          assert.equal(audit.ok, false);
          assert.equal(audit.issues[0].code, "SESSION_IMMUTABLE_STORAGE_INVALID");
          if (damage === "missing") {
            let planId;
            await assert.rejects(
              prepareSessionArtifactCleanup({ ...options, dryRun: false }),
              (error) => {
                assert.equal(error.code, "SESSION_MAINTENANCE_PREPARATION_INTERRUPTED");
                assert.equal(error.cause.code, "SESSION_IMMUTABLE_STORAGE_INVALID");
                planId = error.planId;
                return true;
              },
            );
            await discardSessionArtifactCleanup({ ...options, planId });
          } else {
            const plan = await prepareSessionArtifactCleanup({ ...options, dryRun: false });
            const result = await cleanupSessionArtifacts({ ...options, planId: plan.planId });
            assert.equal(result.complete, true);
            assert.equal(result.removed.includes(file), false);
            await discardSessionArtifactCleanup({ ...options, planId: plan.planId });
            assert.equal((await auditImmutableSession({ sessionDir })).ok, false);
          }
          const repaired = await repairSessionArtifacts({
            ...options,
            alreadyLocked: false,
            objectReplacements: replacements,
          });
          assert.equal(repaired.before.storage.ok, false);
          assert.equal(repaired.after.ok, true, JSON.stringify(repaired.after));
          assert.equal(repaired.repaired.length, 1, "one physical segment is restored");
          for await (const location of store.objects.physicalReferences(snapshot)) {
            const record = decodeImmutableRecordReference(location);
            const replacement = replacements.find(({ reference }) => reference === record.digest);
            if (replacement)
              assert.deepEqual(await store.objects.segments.read(location), replacement.bytes);
          }
          assert.deepEqual(await readFile(store.headPath), head);
          assert.deepEqual(await store.get(snapshot, "messages", "m"), value);
        });
      }
    }

    test("content repair validates the entire overlay before restoring any object", async (t) => {
      const { store, reference, options } = await fixture(t);
      const objects = await valueObjects(store, reference);
      const leaves = [...objects].filter(([, object]) => object.kind === "data").slice(0, 2);
      assert.equal(leaves.length, 2);
      for (const [object] of leaves) await corruptRecord(store, object);
      const [first, second] = leaves;
      const restore = (entries) =>
        repairSessionArtifacts({
          ...options,
          alreadyLocked: false,
          objectReplacements: entries.map(([object, { bytes }]) => ({ reference: object, bytes })),
        });
      await assert.rejects(restore([first]), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
      for (const [object] of leaves)
        await assert.rejects(readCommittedRecord(store, object), {
          code: "SESSION_IMMUTABLE_STORAGE_INVALID",
        });
      assert.equal((await restore([first, second])).after.ok, true);
    });
  });
}
