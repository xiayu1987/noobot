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
import { ImmutableSessionChanges } from "../../src/session/session-artifact-session/immutable-message-changes.js";
import {
  seedImmutableArtifactEventIndex,
  indexImmutableArtifactEvent,
  readImmutableArtifactEvents,
  verifyImmutableArtifactEventIndex,
} from "../../src/session/session-artifact-session/immutable-artifact-event-index.js";
import { upgradeImmutableArtifactEventIndex } from "../../src/session/session-artifact-session/immutable-artifact-event-index-upgrade.js";
import { auditImmutableSession } from "../../src/session/session-artifact-session/immutable-session-audit.js";
import { requireImmutableArtifactEventIndex } from "@noobot/session-protocol/immutable-storage-graph";

async function fixture(t, indexed = true) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "artifact-event-index-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "s1", allowCreate: true });
  await store.transact({
    expectedGeneration: 0,
    operationId: "initialize",
    input: {},
    prepare: async ({ get }) => {
      const plan = new ImmutableSessionChanges(get);
      if (indexed) seedImmutableArtifactEventIndex(plan);
      for (const ordinal of [6, 1, 4, 2, 5, 3]) {
        const eventId = `e${ordinal}`;
        const record = {
          eventId,
          ordinal,
          artifact: ordinal === 2 || ordinal === 5,
          envelope: { identity: { eventId, sessionId: "s1" } },
        };
        plan.set("events", eventId, record);
        if (indexed) await indexImmutableArtifactEvent(store, plan, record);
      }
      plan.set("metadata", "events", { sequence: 6 });
      return { changes: plan.changes(), result: {} };
    },
  });
  return store;
}
async function read(store, snapshot) {
  return store.objects.withSnapshot(snapshot, () => readImmutableArtifactEvents(store, snapshot));
}
async function mutate(store, changes) {
  const snapshot = await store.snapshot();
  return store.transact({
    expectedGeneration: snapshot.generation,
    operationId: `mutate:${snapshot.generation}`,
    input: {},
    prepare: async () => ({ changes, result: {} }),
  });
}

test("artifact index shares authoritative references, reads only members and preserves committed order", async (t) => {
  const store = await fixture(t);
  const snapshot = await store.snapshot();
  const requested = [];
  const readValue = store.objects.readValue.bind(store.objects);
  t.mock.method(store.objects, "readValue", async (reference) => {
    requested.push(reference);
    return readValue(reference);
  });
  const envelopes = await read(store, snapshot);
  assert.deepEqual(
    envelopes.map((event) => event.identity.eventId),
    ["e2", "e5"],
  );
  assert.equal(requested.length, 3);
  await store.objects.withSnapshot(snapshot, async () => {
    const descriptor = await store.get(snapshot, "metadata", "artifactEventIndex");
    const eventsRoot = await store.index.get(snapshot.root, "events");
    for await (const [eventId, reference] of store.index.entries(descriptor.root))
      assert.equal(reference, await store.index.get(eventsRoot, eventId));
    await verifyImmutableArtifactEventIndex(store, snapshot);
  });
  assert.equal((await auditImmutableSession({ sessionDir: store.sessionDir })).ok, true);
});

test("offline rebuild reuses original event references, is idempotent and keeps pinned snapshots", async (t) => {
  const store = await fixture(t, false);
  const pinned = await store.snapshot();
  await assert.rejects(read(store, pinned), { code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED" });
  const upgrade = () => upgradeImmutableArtifactEventIndex({ sessionDir: store.sessionDir });
  assert.equal((await upgrade()).result.upgraded, true);
  const snapshot = await store.snapshot();
  assert.deepEqual(
    (await read(store, snapshot)).map((event) => event.identity.eventId),
    ["e2", "e5"],
  );
  await assert.rejects(read(store, pinned), { code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED" });
  assert.equal((await upgrade()).result.upgraded, false);
  assert.equal((await store.snapshot()).generation, snapshot.generation);
  assert.equal((await auditImmutableSession({ sessionDir: store.sessionDir })).ok, true);
});

test("audit rejects removal of an index that was committed previously", async (t) => {
  const store = await fixture(t);
  await mutate(store, [{ collection: "metadata", key: "artifactEventIndex", remove: true }]);
  const audit = await auditImmutableSession({ sessionDir: store.sessionDir });
  assert.equal(audit.ok, false);
  assert.match(audit.issues[0].message, /Committed artifact event index is missing/);
});

test("audit accepts historical sessions before their offline index upgrade", async (t) => {
  const store = await fixture(t, false);
  assert.equal((await auditImmutableSession({ sessionDir: store.sessionDir })).ok, true);
});

test("empty artifact index does not traverse historical event records", async (t) => {
  const store = await fixture(t);
  await mutate(store, [
    {
      collection: "metadata",
      key: "artifactEventIndex",
      value: { version: 1, count: 0, root: null },
    },
  ]);
  const snapshot = await store.snapshot();
  const readValue = store.objects.readValue.bind(store.objects);
  let reads = 0;
  t.mock.method(store.objects, "readValue", async (reference) => {
    reads += 1;
    assert.equal(reads, 1);
    return readValue(reference);
  });
  assert.deepEqual(await read(store, snapshot), []);
  assert.equal(reads, 1);
});

test("audit rejects missing membership even when an empty descriptor is structurally valid", async (t) => {
  const store = await fixture(t);
  await mutate(store, [
    {
      collection: "metadata",
      key: "artifactEventIndex",
      value: { version: 1, count: 0, root: null },
    },
  ]);
  const audit = await auditImmutableSession({ sessionDir: store.sessionDir });
  assert.equal(audit.ok, false);
  assert.match(audit.issues[0].message, /membership is incomplete/);
});

test("audit rejects stale indexed references after an authority record changes", async (t) => {
  const store = await fixture(t);
  const record = await store.get(await store.snapshot(), "events", "e2");
  await mutate(store, [{ collection: "events", key: "e2", value: { ...record, changed: true } }]);
  const audit = await auditImmutableSession({ sessionDir: store.sessionDir });
  assert.equal(audit.ok, false);
  assert.match(audit.issues[0].message, /disagrees with authoritative events/);
});

test("unknown versions and inconsistent descriptors fail explicitly", () => {
  for (const value of [
    { version: 2, count: 0, root: null },
    { version: 1, count: 1, root: null },
  ])
    assert.throws(() => requireImmutableArtifactEventIndex(value), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
});

test("incomplete historical events abort upgrade without publishing a partial index", async (t) => {
  const store = await fixture(t, false);
  await mutate(store, [{ collection: "events", key: "e4", remove: true }]);
  const before = await store.snapshot();
  await assert.rejects(
    upgradeImmutableArtifactEventIndex({ sessionDir: store.sessionDir }),
    /Incomplete authority events/,
  );
  assert.deepEqual(await store.snapshot(), before);
  assert.equal(await store.get(before, "metadata", "artifactEventIndex"), null);
});
