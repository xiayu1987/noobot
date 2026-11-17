/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableRecordStore } from "../../src/session/session-artifact-session/immutable-record-store.js";
import { ImmutableLocatedRecordStore } from "../../src/session/session-artifact-session/immutable-located-record-store.js";
import { migrateImmutableSessionSegments } from "../../src/session/session-artifact-session/immutable-segment-migration.js";
import { auditImmutableSession } from "../../src/session/session-artifact-session/immutable-session-audit.js";
import { acquireImmutableReaderRetention } from "../../src/session/session-artifact-session/immutable-reader-retention.js";
import {
  compactSessionArtifacts,
  cleanupSessionArtifacts,
  discardSessionArtifactCleanup,
} from "../../src/session/session-artifact-maintenance.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { prepareSessionArtifactCleanupToCompletion as prepareSessionArtifactCleanup } from "../helpers/immutable-cleanup.js";
import { JsonLocatedFixture } from "../helpers/json-located-store.js";
import { wrapLegacyCommitIndex } from "../helpers/wrapped-commit-index.js";
import { decodeImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";

async function cleanup(options) {
  const plan = await prepareSessionArtifactCleanup({ ...options, dryRun: false });
  try {
    for (let step = 0; step <= plan.candidates; step += 1) {
      const result = await cleanupSessionArtifacts({
        ...options,
        planId: plan.planId,
        maxCandidates: 1,
        maxRemovals: 1,
      });
      assert.ok(result.processedCandidates <= 1);
      if (result.complete) return;
    }
    assert.fail("migrated cleanup did not finish within its candidate count");
  } finally {
    await discardSessionArtifactCleanup({ ...options, planId: plan.planId });
  }
}

for (const objectStore of [ImmutableRecordStore, JsonLocatedFixture, ImmutableLocatedRecordStore]) {
  for (const version of [2, 3]) {
    test(`${objectStore.format} index v${version} migration preserves pinned history through evacuation and cleanup`, async (t) => {
      const sessionDir = await mkdtemp(path.join(tmpdir(), "migrated-maintenance-"));
      const resources = new AsyncDisposableStack();
      t.after(() => resources.disposeAsync());
      resources.defer(() => rm(sessionDir, { recursive: true, force: true }));
      const source = new ImmutableSessionStore({
        sessionDir,
        sessionId: "migrate-maintenance",
        objectStore,
        allowCreate: true,
      });
      const content = "中🙂".repeat(40000);
      await source.commit({
        expectedGeneration: 0,
        operationId: "seed",
        changes: [{ collection: "messages", key: "m1", value: { message: { content } } }],
      });
      const retry = {
        expectedGeneration: 1,
        operationId: "update",
        changes: [{ collection: "metadata", key: "name", value: "updated" }],
      };
      await source.commit(retry);
      await wrapLegacyCommitIndex(source, version);
      await migrateImmutableSessionSegments({ sessionDir });
      const target = await ImmutableSessionStore.open({ sessionDir });
      const retention = await acquireImmutableReaderRetention(target, async () => {});
      resources.defer(() => retention.release());
      const captured = retention.head;

      await target.commit({
        expectedGeneration: captured.generation,
        operationId: "rollover",
        changes: [
          {
            collection: "metadata",
            key: "rollover",
            value: Array.from(
              { length: 80 },
              (_, i) => `${i}:` + String.fromCharCode(33 + i).repeat(65536),
            ).join(""),
          },
        ],
      });
      const rolled = await target.snapshot();
      assert.notEqual(rolled.segmentTail.segmentId, captured.segmentTail.segmentId);
      const oldSegments = new Set();
      for await (const [, sourceLocation] of target.objects.locations.entries(
        captured.locationRoot,
      ))
        oldSegments.add(decodeImmutableRecordReference(sourceLocation).segmentId);
      const oldFiles = [...oldSegments].map((id) => target.objects.segments.segmentPath(id));
      assert.ok(oldFiles.length > 0);
      const sources = [];

      for await (const [identity, sourceLocation] of target.objects.locations.entries(
        rolled.locationRoot,
      ))
        if (oldSegments.has(decodeImmutableRecordReference(sourceLocation).segmentId))
          sources.push({ identity, sourceLocation });
      const options = { storageService, sessionDir, assertSessionWritable: async () => {} };
      for (let offset = 0; offset < sources.length; offset += 8)
        await compactSessionArtifacts({
          ...options,
          operationId: `evacuate-migrated-${offset}`,
          expectedGeneration: (await target.snapshot()).generation,
          records: sources.slice(offset, offset + 8),
        });
      const beforeCleanup = await auditImmutableSession({ sessionDir });
      assert.equal(beforeCleanup.ok, true, JSON.stringify(beforeCleanup.issues));
      await cleanup(options);
      for (const file of oldFiles) await readFile(file);
      assert.equal((await target.get(captured, "messages", "m1")).message.content, content);
      await retention.release();
      await cleanup(options);
      for (const file of oldFiles) await assert.rejects(readFile(file), { code: "ENOENT" });
      const reopened = await ImmutableSessionStore.open({ sessionDir });
      assert.equal(
        (await reopened.get(await reopened.snapshot(), "messages", "m1")).message.content,
        content,
      );
      assert.equal((await reopened.commit(retry)).replayed, true);
      const report = await auditImmutableSession({ sessionDir });
      assert.equal(report.ok, true, JSON.stringify(report.issues));
    });
  }
}
