/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { createStorageDigest } from "#storage-digest";
import { deepFreeze, isDeepFrozen } from "@noobot/shared/deep-freeze";
import {
  collectSessionArtifactEventIdentityErrors,
  sessionArtifactEventsError,
} from "./session-artifact-events.js";

export const SESSION_ARTIFACT_EVENT_JOURNAL_FILE = "artifact-events/events.jsonl";

const revisionStates = new WeakMap();

function extendRevision(digest, events, offset) {
  for (let index = offset; index < events.length; index += 1) {
    if (index) digest.update(",");
    digest.update(JSON.stringify(events[index]));
  }
  return digest;
}

function retainRevision(events, sessionId, digest) {
  const revision = `sha256:${digest.copy().update("]").digest("hex")}`;
  if (isDeepFrozen(events)) revisionStates.set(events, { sessionId, digest, revision });
  return revision;
}

export function sessionArtifactEventRevision(events, sessionId) {
  const cached = revisionStates.get(events);
  if (cached?.sessionId === sessionId) return cached.revision;
  const errors = collectSessionArtifactEventIdentityErrors(events, sessionId);
  if (errors.length) throw sessionArtifactEventsError(errors);
  return retainRevision(
    events,
    sessionId,
    extendRevision(createStorageDigest().update("["), events, 0),
  );
}

export function assertSessionArtifactJournalIndex(index) {
  if (
    !isPlainObject(index) ||
    index.file !== SESSION_ARTIFACT_EVENT_JOURNAL_FILE ||
    !Number.isSafeInteger(index.committedBytes) ||
    index.committedBytes < 0 ||
    !Number.isSafeInteger(index.eventCount) ||
    index.eventCount < 0 ||
    !/^sha256:[0-9a-f]{64}$/.test(index.eventRevision)
  ) {
    throw sessionArtifactEventsError(["invalid_artifact_journal_index"]);
  }
  return index;
}

export function materializeSessionArtifactJournal(records, index, sessionId) {
  assertSessionArtifactJournalIndex(index);
  const events = new Map();
  for (const record of records) {
    if (!isPlainObject(record) || !isCanonicalText(record.eventId)) {
      throw sessionArtifactEventsError(["invalid_artifact_journal_record"]);
    }
    if (
      record.op === "append" &&
      record.envelope?.identity?.eventId === record.eventId &&
      !events.has(record.eventId)
    ) {
      events.set(record.eventId, record.envelope);
    } else if (record.op === "remove" && events.has(record.eventId)) {
      events.delete(record.eventId);
    } else {
      throw sessionArtifactEventsError(["invalid_artifact_journal_operation"]);
    }
  }
  const projected = deepFreeze([...events.values()]);
  if (
    projected.length !== index.eventCount ||
    sessionArtifactEventRevision(projected, sessionId) !== index.eventRevision
  ) {
    throw sessionArtifactEventsError(["artifact_journal_index_mismatch"]);
  }
  return projected;
}

export function diffSessionArtifactEvents(previous, events, sessionId) {
  const errors = collectSessionArtifactEventIdentityErrors(events, sessionId);
  if (errors.length) throw sessionArtifactEventsError(errors);
  if (
    isDeepFrozen(previous) &&
    isDeepFrozen(events) &&
    events.length >= previous.length &&
    previous.every((envelope, index) => events[index] === envelope)
  ) {
    sessionArtifactEventRevision(previous, sessionId);
    retainRevision(
      events,
      sessionId,
      extendRevision(revisionStates.get(previous).digest.copy(), events, previous.length),
    );
    return events
      .slice(previous.length)
      .map((envelope) => ({ op: "append", eventId: envelope.identity.eventId, envelope }));
  }
  const previousById = new Map(previous.map((envelope) => [envelope.identity.eventId, envelope]));
  const nextIds = new Set(events.map((envelope) => envelope.identity.eventId));
  const records = [];
  for (const envelope of previous) {
    if (!nextIds.has(envelope.identity.eventId))
      records.push({ op: "remove", eventId: envelope.identity.eventId });
  }
  for (const envelope of events) {
    const eventId = envelope.identity.eventId;
    const existing = previousById.get(eventId);
    if (!existing) records.push({ op: "append", eventId, envelope });
    else if (existing !== envelope && JSON.stringify(existing) !== JSON.stringify(envelope))
      throw sessionArtifactEventsError(["artifact_event_identity_reused"]);
  }
  const retainedOrder = previous
    .filter((event) => nextIds.has(event.identity.eventId))
    .map((event) => event.identity.eventId);
  const nextRetainedOrder = events
    .filter((event) => previousById.has(event.identity.eventId))
    .map((event) => event.identity.eventId);
  if (JSON.stringify(retainedOrder) !== JSON.stringify(nextRetainedOrder))
    throw sessionArtifactEventsError(["artifact_event_order_changed"]);
  return records;
}
