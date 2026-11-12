/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { storageDigest } from "#storage-digest";
import {
  collectSessionArtifactEventIdentityErrors,
  sessionArtifactEventsError,
} from "./session-artifact-events.js";

export const SESSION_ARTIFACT_EVENT_JOURNAL_FILE = "artifact-events/events.jsonl";

export function sessionArtifactEventRevision(events, sessionId) {
  const errors = collectSessionArtifactEventIdentityErrors(events, sessionId);
  if (errors.length) throw sessionArtifactEventsError(errors);
  return `sha256:${storageDigest(JSON.stringify(events))}`;
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
  const projected = [...events.values()];
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
