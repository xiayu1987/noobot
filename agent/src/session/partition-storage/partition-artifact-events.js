/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { validateProtocolEvent } from "@noobot/event-protocol";
import { PARTITION_SESSION_ARTIFACT_EVENTS } from "@noobot/session-protocol/partition-collections";
import {
  assertAuthorityEventSequenceAdvance,
  assertNewAuthorityEventScope,
  assertUncommittedAuthorityEvent,
  appendAuthorityOutboxTurnRange,
  authorityOutboxPositionKey,
  authorityOutboxSequenceKey,
  encodeStoredAuthorityOutboxEvent,
  normalizeAuthorityEventOutbox,
  requireAuthorityOutboxTurnRange,
} from "@noobot/event-protocol/outbox";
import {
  PLUGIN_ARTIFACT_FAMILY,
  isCommittedArtifactRetired,
  pluginArtifactKey,
  reducePluginArtifact,
  requirePluginArtifactProjection,
  requirePluginArtifactAuthority,
} from "@noobot/event-protocol/plugin-artifact-event";
import { applySessionMetadataCommit, decideAggregateConcurrency } from "@noobot/session-protocol";
import {
  PARTITION_LIFECYCLE_HEADER,
  requirePartitionOutboxTail,
} from "@noobot/session-protocol/partition-transaction";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import {
  partitionAuthorityEventRecord,
  requireCommittedEventPosition,
} from "./partition-event-visibility.js";
import { requirePartitionEventSequenceFloor } from "@noobot/session-protocol/partition-session-state";

function corrupt(message, cause) {
  throw Object.assign(partitionJournalError("SESSION_STORAGE_CORRUPT", message), { cause });
}

function requireArtifact(current, identity) {
  try {
    return requirePluginArtifactProjection(current, identity);
  } catch (cause) {
    corrupt("Invalid partition plugin artifact projection", cause);
  }
}

export async function isPartitionArtifactRetired(read, event, tail) {
  try {
    return await isCommittedArtifactRetired(
      async (key) => {
        const entry = (await read({ collection: "metadata", keys: [key] })).get(key);
        return entry === null ? null : entry.value;
      },
      event,
      tail,
    );
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    corrupt("Invalid partition artifact retirement", cause);
  }
}

export async function readPartitionPluginArtifact(read, identity, { scope }) {
  const key = pluginArtifactKey(identity);
  const record = (await read({ collection: "pluginArtifacts", keys: [key] })).get(key);
  const current = requireArtifact(record === null ? null : record.value, identity);
  if (current === null) return null;
  const stored = (await read({ collection: "events", keys: [current.eventId] })).get(
    current.eventId,
  );
  const event = partitionAuthorityEventRecord(stored?.value, current.eventId, scope);
  requireArtifactAuthority(current, event.envelope, identity);
  const tail = await requireCommittedEventPosition(async (collection, key) => {
    const entry = (await read({ collection, keys: [key] })).get(key);
    return entry === null ? null : entry.value;
  }, event);
  return (await isPartitionArtifactRetired(read, event, tail)) ? null : current;
}

async function advanceAggregate(staged, envelope) {
  const metadata = await staged.get("metadata", "session");
  if (metadata === null) corrupt("Missing partition session metadata");
  const concurrency = decideAggregateConcurrency({
    expectedAggregateVersion: null,
    aggregateVersion: metadata.aggregateVersion,
  });
  if (
    !concurrency.allowed ||
    envelope.ordering.aggregateVersion !== concurrency.nextAggregateVersion
  )
    throw new TypeError("Authority event aggregate version mismatch");
  staged.set(
    "metadata",
    "session",
    applySessionMetadataCommit(metadata, {
      aggregateVersion: concurrency.nextAggregateVersion,
      committedAt: metadata.updatedAt,
    }),
    (await staged.entries("metadata", ["session"])).get("session"),
  );
}

function requireArtifactAuthority(current, envelope, identity) {
  try {
    return requirePluginArtifactAuthority(current, envelope, identity);
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    corrupt("Invalid partition plugin artifact authority", cause);
  }
}

async function projectArtifact(staged, envelope, scope) {
  if (envelope.protocol.family !== PLUGIN_ARTIFACT_FAMILY) return;
  const key = pluginArtifactKey(envelope.payload);
  const previous = (await staged.entries("pluginArtifacts", [key])).get(key);
  const current = await readPartitionPluginArtifact(staged.read, envelope.payload, { scope });
  const reduced = reducePluginArtifact(current, envelope);
  if (!reduced.applied) throw new TypeError(`Plugin artifact rejected: ${reduced.reason}`);
  staged.set("pluginArtifacts", key, reduced.artifact, previous);
}

export async function preparePartitionAuthorityEvents(staged, sources, scope) {
  const eventIds = [];
  for (const source of sources) {
    const [record] = normalizeAuthorityEventOutbox([source]);
    assertNewAuthorityEventScope(record, scope);
    const { envelope, eventId } = record;
    const validation = validateProtocolEvent(envelope);
    if (!validation.valid)
      throw new TypeError(`Invalid authority event: ${validation.errors.join(",")}`);
    const isArtifact = validation.descriptor.sessionArtifact === true;
    const visibility = await staged.readVisibility([envelope.identity.turnScopeId]);
    if (!visibility.get(envelope.identity.turnScopeId))
      throw new TypeError("Authority event requires a visible turn");
    assertUncommittedAuthorityEvent(await staged.get("events", eventId));
    const key = authorityOutboxSequenceKey(envelope.ordering.domain, envelope.ordering.scopeId);
    const previousSequence = (await staged.entries("eventSequences", [key])).get(key);
    const floor =
      previousSequence === null || previousSequence.mutation.remove
        ? 0
        : requirePartitionEventSequenceFloor(previousSequence.mutation.value);
    assertAuthorityEventSequenceAdvance(envelope, floor);
    if (isArtifact) {
      await advanceAggregate(staged, envelope);
      await projectArtifact(staged, envelope, scope);
      staged.set(PARTITION_SESSION_ARTIFACT_EVENTS, eventId, true, null);
    }
    const { collection, key: headerKey } = PARTITION_LIFECYCLE_HEADER;
    const previousHeader = (await staged.entries(collection, [headerKey])).get(headerKey);
    const header = await staged.get(collection, headerKey);
    const tail = requirePartitionOutboxTail(header);
    const ordinal = tail + 1;
    authorityOutboxPositionKey(ordinal);
    const turnScopeId = envelope.identity.turnScopeId;
    const previousRange = (await staged.entries("turnOutbox", [turnScopeId])).get(turnScopeId);
    const range = await staged.get("turnOutbox", turnScopeId);
    if (range !== null) requireAuthorityOutboxTurnRange(range, turnScopeId, tail);
    staged.set(
      "turnOutbox",
      turnScopeId,
      appendAuthorityOutboxTurnRange(range, turnScopeId, ordinal),
      previousRange,
    );
    staged.set(collection, headerKey, { ...header, outboxTail: ordinal }, previousHeader);
    staged.set("events", eventId, encodeStoredAuthorityOutboxEvent({ ...record, ordinal }), null);
    staged.set("eventOrder", authorityOutboxPositionKey(ordinal), eventId, null);
    staged.set(
      "eventSequences",
      key,
      envelope.ordering.sequence,
      (await staged.entries("eventSequences", [key])).get(key),
    );
    eventIds.push(eventId);
  }
  return eventIds;
}
