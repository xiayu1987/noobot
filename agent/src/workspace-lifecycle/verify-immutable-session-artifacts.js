/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDeepStrictEqual } from "node:util";
import {
  isArtifactRetirementKey,
  pluginArtifactKey,
  requireCommittedArtifactRetirement,
} from "@noobot/event-protocol/plugin-artifact-event";
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";
import { PARTITION_SESSION_ARTIFACT_EVENTS } from "@noobot/session-protocol/partition-collections";
import { readPartitionPluginArtifact } from "../session/partition-storage/partition-artifact-events.js";
import {
  readPartitionIndexedArtifactEvent,
  readPartitionOutboxTail,
} from "../session/partition-storage/partition-outbox.js";
import { PartitionSessionTransactions } from "../session/partition-storage/partition-session-transactions.js";
import { PartitionTransactions } from "../session/partition-storage/partition-transactions.js";

function requireKey(key, projection) {
  if (projection === null || pluginArtifactKey(projection) !== key)
    throw immutableStorageError(`Invalid plugin artifact index identity: ${key}`);
}

function requireCommittedRetirement(key, value, tail, side) {
  try {
    return requireCommittedArtifactRetirement(value, tail);
  } catch (cause) {
    const message = cause.message;
    throw Object.assign(
      immutableStorageError(`${side} ${message[0].toLowerCase()}${message.slice(1)}: ${key}`),
      { cause },
    );
  }
}

async function verifyRetirements({ source, session, collections, scope, snapshot, signal }) {
  const sourceTail = await source.readOutboxTail();
  const targetTail = await session.read(snapshot, (read) =>
    readPartitionOutboxTail(read, scope, snapshot),
  );
  const readTarget = (key) =>
    session.read(snapshot, async (read) => {
      const entry = (await read({ collection: "metadata", keys: [key] })).get(key);
      return entry === null
        ? null
        : requireCommittedRetirement(key, entry.value, targetTail, "Staged");
    });
  await source.visitCollection("metadata", async (key, expected) => {
    signal?.throwIfAborted();
    if (!isArtifactRetirementKey(key)) return;
    const position = requireCommittedRetirement(key, expected, sourceTail, "Source");
    if ((await readTarget(key)) !== position)
      throw immutableStorageError(`Staged artifact retirement differs from source: ${key}`);
  });
  await collections.visitCollectionKeys(snapshot, ["metadata"], async (key) => {
    signal?.throwIfAborted();
    if (!isArtifactRetirementKey(key)) return;
    const actual = await readTarget(key);
    if (actual !== null && (await source.readMetadataEntry(key)) === null)
      throw immutableStorageError(`Staged session has an extra artifact retirement: ${key}`);
  });
}

export async function verifyImmutableSessionArtifacts({
  source,
  journal,
  scope,
  snapshot,
  signal,
}) {
  const session = new PartitionSessionTransactions(journal, scope);
  const collections = new PartitionTransactions(journal);
  await verifyRetirements({ source, session, collections, scope, snapshot, signal });
  const readTarget = (identity) =>
    session.read(snapshot, (read) => readPartitionPluginArtifact(read, identity, { scope }));
  await source.visitCollection("pluginArtifacts", async (key, projection) => {
    signal?.throwIfAborted();
    requireKey(key, projection);
    const expected = await source.readPluginArtifact(projection);
    const actual = await readTarget(projection);
    if (!isDeepStrictEqual(expected, actual))
      throw immutableStorageError(`Staged plugin artifact differs from source: ${key}`);
  });
  await collections.visitCollectionKeys(snapshot, ["pluginArtifacts"], async (key, collection) => {
    signal?.throwIfAborted();
    const projection = await session.read(snapshot, async (read) => {
      const entry = (await read({ collection, keys: [key] })).get(key);
      return entry === null ? null : entry.value;
    });
    if (projection === null) return;
    requireKey(key, projection);
    const actual = await readTarget(projection);
    if (actual !== null && (await source.readPluginArtifact(projection)) === null)
      throw immutableStorageError(`Staged session has an extra plugin artifact: ${key}`);
  });
  const readEvent = (eventId) =>
    session.read(snapshot, (read) =>
      readPartitionIndexedArtifactEvent(read, scope, snapshot, eventId),
    );
  await source.visitArtifactEvents(async ({ eventId, envelope, ordinal, committedAt }) => {
    signal?.throwIfAborted();
    const actual = await readEvent(eventId);
    if (
      actual === null ||
      actual.ordinal !== ordinal ||
      actual.committedAt !== committedAt ||
      !isDeepStrictEqual(actual.envelope, envelope)
    )
      throw immutableStorageError(`Staged session artifact event differs from source: ${eventId}`);
  });
  await collections.visitCollectionKeys(
    snapshot,
    [PARTITION_SESSION_ARTIFACT_EVENTS],
    async (eventId) => {
      signal?.throwIfAborted();
      if ((await readEvent(eventId)) !== null && !(await source.hasArtifactEvent(eventId)))
        throw immutableStorageError(`Staged session has an extra artifact event: ${eventId}`);
    },
  );
}
