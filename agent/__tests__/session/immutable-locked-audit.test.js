/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { auditLockedImmutableSession } from "../../src/session/session-artifact-session/immutable-session-audit.js";
import { openSessionArtifactReader } from "../../src/session/session-artifact-session/immutable-session-reader.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { sessionMutationCoordinator } from "../../src/session/session-mutation-coordinator.js";
import { decodeImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-locked-audit-"));
  t.after(async () => {
    resetFsAdapter();
    await rm(sessionDir, { recursive: true, force: true });
  });
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "audit", allowCreate: true });
  const advance = (generation) =>
    store.commit({
      expectedGeneration: generation,
      operationId: `generation-${generation + 1}`,
      changes: [
        {
          collection: "metadata",
          key: "session",
          value: {
            sessionId: "audit",
            parentSessionId: "",
            generation: generation + 1,
          },
        },
      ],
    });
  await advance(0);
  return { store, sessionDir, advance };
}

test(
  "locked audit excludes concurrent publication until all object reads finish",
  { timeout: 5000 },
  async (t) => {
    const { store, sessionDir, advance } = await fixture(t);
    const entered = Promise.withResolvers();
    const resume = Promise.withResolvers();
    t.after(() => resume.resolve());
    let paused = false;
    setFsAdapter({
      open: async (file, flags, ...args) => {
        if (
          !paused &&
          flags === "r" &&
          String(file).startsWith(store.objects.segments.directory + path.sep)
        ) {
          paused = true;
          entered.resolve();
          await resume.promise;
        }
        return open(file, flags, ...args);
      },
    });
    const auditing = auditLockedImmutableSession({ sessionDir, batchSize: 1 });
    await entered.promise;
    let published = false;
    const writing = advance(1).then((result) => {
      published = true;
      return result;
    });
    await setImmediate();
    assert.equal(published, false);
    resume.resolve();
    const report = await auditing;
    await writing;
    assert.equal(report.ok, true, JSON.stringify(report));
    assert.equal(report.generation, 1);
    assert.equal((await store.snapshot()).generation, 2);
  },
);

test("locked audit validates retained historical roots without retention publication or directory sync", async (t) => {
  const { store, sessionDir, advance } = await fixture(t);
  await using reader = await openSessionArtifactReader({ sessionDir });
  const historical = await store.snapshot();
  await advance(1);
  assert.equal((await reader.readMetadata()).generation, historical.generation);

  await sessionMutationCoordinator.run(store.lockPath, async () => {
    setFsAdapter({
      open: async (file, flags, ...args) => {
        assert.notEqual(flags, "wx", "locked audit must not publish a retention record");
        const handle = await open(file, flags, ...args);
        if (flags === "r") handle.sync = async () => assert.fail("audit must not sync directories");
        return handle;
      },
    });
    try {
      assert.equal((await auditLockedImmutableSession({ sessionDir })).ok, true);
      const record = decodeImmutableRecordReference(
        await store.objects.locations.get(historical.locationRoot, historical.root),
      );
      const handle = await open(store.objects.segments.segmentPath(record.segmentId), "r+");
      try {
        await handle.write(Buffer.from([0xff]), 0, 1, record.offset);
      } finally {
        await handle.close();
      }
      const report = await auditLockedImmutableSession({ sessionDir });
      assert.equal(report.ok, false, "an open historical reader must still be audited");
    } finally {
      resetFsAdapter();
    }
  });
});
