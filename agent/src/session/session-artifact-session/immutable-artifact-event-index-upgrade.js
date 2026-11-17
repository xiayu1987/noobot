/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireImmutableArtifactEventIndex } from "@noobot/session-protocol/immutable-storage-graph";
import { ImmutableSessionStore } from "./immutable-session-store.js";
import { ImmutableSessionChanges } from "./immutable-message-changes.js";
import { immutableStorageError } from "./immutable-object-store.js";
import { seedImmutableArtifactEventIndex } from "./immutable-artifact-event-index.js";

export async function upgradeImmutableArtifactEventIndex({ sessionDir, sessionId }) {
  const store = await ImmutableSessionStore.open({ sessionDir, sessionId });
  const snapshot = await store.snapshot();
  return store.transact({
    expectedGeneration: snapshot.generation,
    operationId: `upgrade-artifact-event-index:${snapshot.generation}`,
    input: {},
    prepare: async ({ snapshot: pinned, get }) => {
      const previous = await get("metadata", "artifactEventIndex");
      if (previous !== null) {
        requireImmutableArtifactEventIndex(previous, store.requireReference);
        return { abort: true, changes: [], result: { upgraded: false } };
      }
      const header = await get("metadata", "events");
      if (!header || !Number.isSafeInteger(header.sequence) || header.sequence < 0)
        throw immutableStorageError("Missing event sequence during artifact index upgrade");
      const plan = new ImmutableSessionChanges(get);
      seedImmutableArtifactEventIndex(plan);
      const root = await store.index.get(pinned.root, "events");
      const entries = [];
      const ordinals = new Set();
      let total = 0;
      for await (const [eventId, reference] of store.index.entries(root)) {
        const record = await store.objects.readValue(reference);
        if (
          record.eventId !== eventId ||
          record.envelope?.identity.eventId !== eventId ||
          record.envelope.identity.sessionId !== store.sessionId ||
          typeof record.artifact !== "boolean" ||
          !Number.isSafeInteger(record.ordinal) ||
          record.ordinal < 1 ||
          record.ordinal > header.sequence ||
          ordinals.has(record.ordinal)
        )
          throw immutableStorageError("Invalid authority event during artifact index upgrade");
        ordinals.add(record.ordinal);
        total += 1;
        if (record.artifact) entries.push([eventId, reference]);
      }
      if (total !== header.sequence)
        throw immutableStorageError("Incomplete authority events during artifact index upgrade");
      const descriptor = await plan.get("metadata", "artifactEventIndex");
      plan.set("metadata", "artifactEventIndex", {
        ...descriptor,
        count: entries.length,
        root: await store.index.setMany(null, entries),
      });
      return { changes: plan.changes(), result: { upgraded: true } };
    },
  });
}
