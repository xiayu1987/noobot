/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  IMMUTABLE_ARTIFACT_EVENT_INDEX_VERSION,
  requireImmutableArtifactEventIndex,
} from "@noobot/session-protocol/immutable-storage-graph";
import { immutableStorageError } from "./immutable-object-store.js";
import { isCommittedArtifactRetired } from "@noobot/event-protocol/plugin-artifact-event";
import { readImmutableOutboxTail } from "./immutable-outbox.js";

export function seedImmutableArtifactEventIndex(plan) {
  plan.set("metadata", "artifactEventIndex", {
    version: IMMUTABLE_ARTIFACT_EVENT_INDEX_VERSION,
    count: 0,
    root: null,
  });
}

export async function indexImmutableArtifactEvent(store, plan, record) {
  const descriptor = requireImmutableArtifactEventIndex(
    await plan.get("metadata", "artifactEventIndex"),
    store.requireReference,
  );
  if (record.artifact !== true) return;
  const reference = await plan.encode(store, "events", record.eventId);
  if (await store.index.get(descriptor.root, record.eventId))
    throw immutableStorageError("Duplicate artifact event membership");
  const count = descriptor.count + 1;
  if (!Number.isSafeInteger(count)) throw immutableStorageError("Artifact event count overflow");
  const root = await store.index.set(descriptor.root, record.eventId, reference);
  plan.set("metadata", "artifactEventIndex", { ...descriptor, root, count });
}

async function readArtifactIndex(store, snapshot) {
  return requireImmutableArtifactEventIndex(
    await store.get(snapshot, "metadata", "artifactEventIndex"),
    store.requireReference,
  );
}

export async function hasImmutableArtifactEvent(store, snapshot, eventId) {
  const { root } = await readArtifactIndex(store, snapshot);
  return store.objects.withSnapshot(snapshot, async () => {
    const reference = await store.index.get(root, eventId);
    if (reference === null) return false;
    const authority = await store.index.get(snapshot.root, "events");
    const record = await requireIndexedArtifact(store, authority, eventId, reference);
    return !(await isRetired(
      store,
      snapshot,
      record,
      await readImmutableOutboxTail(store, snapshot),
    ));
  });
}

export async function visitImmutableArtifactEvents(store, snapshot, visit) {
  return store.objects.withSnapshot(snapshot, () => visitArtifactIndex(store, snapshot, visit));
}

async function visitArtifactIndex(store, snapshot, visit) {
  const descriptor = await readArtifactIndex(store, snapshot);
  if (descriptor.count === 0) return;
  const authority = await store.index.get(snapshot.root, "events");
  const tail = await readImmutableOutboxTail(store, snapshot);
  let count = 0;
  for await (const [eventId, reference] of store.index.entries(descriptor.root)) {
    const record = await requireIndexedArtifact(store, authority, eventId, reference);
    count += 1;
    if (!(await isRetired(store, snapshot, record, tail))) await visit(record);
  }
  if (count !== descriptor.count)
    throw immutableStorageError("Artifact event index count mismatch");
}

async function requireIndexedArtifact(store, authority, eventId, reference) {
  if ((await store.index.get(authority, eventId)) !== reference)
    throw immutableStorageError("Artifact event index disagrees with authoritative events");
  const record = await store.objects.readValue(reference);
  if (
    record.artifact !== true ||
    record.eventId !== eventId ||
    record.envelope?.identity.eventId !== eventId ||
    record.envelope.identity.sessionId !== store.sessionId ||
    !Number.isSafeInteger(record.ordinal) ||
    record.ordinal < 1
  )
    throw immutableStorageError("Invalid indexed artifact event");
  return record;
}

async function isRetired(store, snapshot, record, tail) {
  try {
    return await isCommittedArtifactRetired(
      (key) => store.get(snapshot, "metadata", key),
      record,
      tail,
    );
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    throw immutableStorageError("Invalid immutable artifact retirement", cause);
  }
}

export async function readImmutableArtifactEvents(store, snapshot) {
  const events = [];
  const ordinals = new Set();
  await visitImmutableArtifactEvents(store, snapshot, (record) => {
    if (ordinals.has(record.ordinal)) throw immutableStorageError("Invalid indexed artifact event");
    ordinals.add(record.ordinal);
    events.push(record);
  });
  events.sort((left, right) => left.ordinal - right.ordinal);
  return events.map((event) => event.envelope);
}

export async function verifyImmutableArtifactEventIndex(store, snapshot) {
  const descriptor = requireImmutableArtifactEventIndex(
    await store.get(snapshot, "metadata", "artifactEventIndex"),
    store.requireReference,
  );
  const expected = new Map();
  const root = await store.index.get(snapshot.root, "events");
  for await (const [eventId, reference] of store.index.entries(root)) {
    const event = await store.objects.readValue(reference);
    if (event.artifact === true) expected.set(eventId, reference);
  }
  let count = 0;
  for await (const [eventId, reference] of store.index.entries(descriptor.root)) {
    if (expected.get(eventId) !== reference)
      throw immutableStorageError("Artifact event index disagrees with authoritative events");
    expected.delete(eventId);
    count += 1;
  }
  if (expected.size || count !== descriptor.count)
    throw immutableStorageError("Artifact event index membership is incomplete");
  await readImmutableArtifactEvents(store, snapshot);
}
